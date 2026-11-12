/**
 * 免密免费模型的本地持久化状态。
 *
 * 复用 DSH 插件里那套零依赖的 `JsonStore`：写入通过「临时文件 + rename」落地，
 * 进程在 flush 中途崩溃也不会留下半截文件。这里只保留状态存储本身，
 * 原插件里的用量/遥测统计（recordUsage / recordTurn / buildStats …）在启动器侧
 * 不需要，已整体移除——启动器只做配置管理，真正的调用发生在别处。
 *
 * 数据目录由调用方通过 `app.getPath('userData')` 解析后传入，不再写 `~/.dsh`。
 *
 * @module src/main/llm-free/store.js
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * 在启动器用户数据目录下解析免密模型的数据目录。
 * @param {string} userDataBase - `app.getPath('userData')` 的返回值
 * @returns {string}
 */
export function resolveDataDir(userDataBase) {
  return path.join(userDataBase || '.', 'llm-free')
}

export class JsonStore {
  /**
   * @param {string} file - 绝对路径
   * @param {object} initial - 文件尚不存在时使用的初值
   */
  constructor(file, initial) {
    this.file = file
    this.value = initial
    this.dirty = false
    this.timer = undefined
    this.disposed = false
    this.load()
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.value = { ...this.value, ...parsed }
      }
    } catch {
      // 文件缺失是正常情况；读不出来则保留初值。损坏文件保留原样以便排查。
      try {
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch { /* 写不进 home 不是本文件的问题 */ }
    }
  }

  get() {
    return this.value
  }

  /** 合并一个补丁并安排写入，返回新值。 */
  update(patch) {
    if (this.disposed) return this.value
    this.value = { ...this.value, ...patch }
    this.schedule()
    return this.value
  }

  /** 通过回调做 read-modify-write（嵌套状态用）。 */
  edit(mutate) {
    if (this.disposed) return this.value
    const next = mutate(structuredClone(this.value))
    if (next !== undefined) this.value = next
    this.schedule()
    return this.value
  }

  schedule(delayMs = 800) {
    if (this.disposed) return
    this.dirty = true
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, delayMs)
    // 遥测/状态绝不能把进程挂起。
    this.timer.unref?.()
  }

  flush() {
    if (!this.dirty || this.disposed) return
    this.dirty = false
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify(this.value, undefined, 2), { mode: 0o600 })
      fs.renameSync(temp, this.file)
    } catch {
      // fail-soft：下一次变更会重试，下游没有强依赖
    }
  }

  dispose() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    this.flush()
    this.disposed = true
    this.dirty = false
  }
}
