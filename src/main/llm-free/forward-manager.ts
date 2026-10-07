/**
 * 转发代理状态机。
 *
 * 持有转发代理的运行时状态（是否在监听、最近一次错误、in-flight 去重哨兵）
 * @module src/main/llm-free/forward-manager.ts
 */

// 依赖`engine/forward.js#startForwardServer` 来绑定端口
import { startForwardServer } from './engine/forward.js'

/** 转发代理句柄（与 startForwardServer 的返回结构对应）。 */
export interface ForwardHandle {
  server: unknown
  port: number
  host: string
  close: () => Promise<void>
}

/** 只允许转发代理绑定回环地址，避免把本机免费额度开给整个子网。 */
export function isLoopbackHost(value: string): boolean {
  const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])
  const raw = String(value ?? '').trim()
  if (raw === '') return false
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return LOOPBACK_NAMES.has(url.hostname.toLowerCase())
}

type StartForwardOptions = Parameters<typeof startForwardServer>[0]

/** 注入「服务态」回调：纯文件不持有这些逻辑，仅透传给真正的转发服务。 */
export interface ForwardManagerOptions {
  complete: StartForwardOptions['complete']
  modelRows: StartForwardOptions['modelRows']
  forwardKey: () => string
  log: (message: string) => void
}

/** syncForward 的入参：转发代理配置里与绑定相关的纯数据切片。 */
export interface ForwardDesired {
  enabled: boolean
  host?: string
  port?: number
}

/** getStatus 里由本管理器负责的片段。 */
export interface ForwardStatusFragment {
  running: boolean
  host?: string
  port?: number
  error?: string
}

/**
 * 转发代理运行时管理器：拥有 `forward` 句柄与 `forwardError` 状态，并对
 * `syncForward` 做 in-flight promise 去重，避免「禁用→启用」跳变时
 * setConfig 与 start 并发双 bind 同一端口、输家写出 EADDRINUSE 假错。
 */
export class ForwardManager {
  private forward: ForwardHandle | null = null
  private forwardError = ''
  private syncForwardPromise: Promise<ForwardStatusFragment | undefined> | null = null

  constructor(private readonly opts: ForwardManagerOptions) {}

  /** 并发去重：同一次调用进行中，后续调用共享同一个 Promise。 */
  syncForward(desired: ForwardDesired): Promise<ForwardStatusFragment | undefined> {
    if (this.syncForwardPromise) return this.syncForwardPromise
    const run = (async (): Promise<ForwardStatusFragment | undefined> => {
      try {
        return await this.syncForwardImpl(desired)
      } finally {
        this.syncForwardPromise = null
      }
    })()
    this.syncForwardPromise = run
    return run
  }

  private async syncForwardImpl(desired: ForwardDesired): Promise<ForwardStatusFragment | undefined> {
    const wanted = desired.enabled === true
    const host = desired.host || '127.0.0.1'
    const port = desired.port
    if (this.forward !== null && wanted && this.forward.host === host && this.forward.port === port) {
      return { running: true, host: this.forward.host, port: this.forward.port }
    }
    if (this.forward === null && !wanted) return { running: false }
    if (this.forward !== null) {
      const closing = this.forward
      this.forward = null
      await closing.close().catch(() => {})
    }
    if (!wanted) {
      this.forwardError = ''
      return { running: false }
    }
    if (!isLoopbackHost(host)) {
      this.forwardError = 'the forward listener binds a loopback address only'
      this.opts.log(`forward listener not started (${this.forwardError})`)
      return { running: false, error: this.forwardError }
    }
    try {
      this.forward = await startForwardServer({
        config: () => ({
          host,
          port: port ?? 0,
          enabled: wanted,
          key: this.opts.forwardKey(),
        }),
        complete: this.opts.complete,
        modelRows: this.opts.modelRows,
        log: (message) => this.opts.log(`forward: ${message}`),
      })
      this.forwardError = ''
      return { running: true, host: this.forward.host, port: this.forward.port }
    } catch (error) {
      this.forwardError = String((error as Error)?.message ?? error)
      this.opts.log(`forward listener could not start (${this.forwardError})`)
      return { running: false, error: this.forwardError }
    }
  }

  /** 关闭当前转发代理并将错误字段复位。 */
  async stop(): Promise<void> {
    if (this.forward !== null) {
      const closing = this.forward
      this.forward = null
      await closing.close().catch(() => {})
    }
    this.forwardError = ''
  }

  /** 返回转发代理的状态片段，供 getStatus 拼装。 */
  getStatusFragment(): ForwardStatusFragment {
    return {
      running: this.forward !== null,
      ...(this.forward ? { host: this.forward.host, port: this.forward.port } : {}),
      ...(this.forwardError ? { error: this.forwardError } : {}),
    }
  }
}
