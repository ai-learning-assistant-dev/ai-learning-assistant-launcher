/**
 * 回归测试: ForwardManager 在执行 start() 方法时不应该重复执行多次。
 *
 * engine/forward.js 去 bind 端口来复现竞态。固定端口易与环境冲突，故用动态空闲端口。
 * 运行：`npm test`
 */
import assert from 'node:assert'
import net from 'node:net'
import { ForwardManager } from '../forward-manager'

/** 取一个当前空闲的本地端口，避免依赖固定端口（18765）被占用导致竞态无法复现。 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      const port = addr.port
      srv.close(() => resolve(port))
    })
  })
}

/**
 * 用户触发「禁用→启用」这个行为时：
 * setConfig 方法触发 `void syncForward()` 触发后立刻触发了 start() 
 * 而 start() 内的也含有一次 `await syncForward()`。
 * 两次绑定同一个Port会触发异常。
 */
async function triggerEnable(m: ForwardManager, port: number): Promise<void> {
  await Promise.all([
    m.syncForward({ enabled: true, host: '127.0.0.1', port }),
    m.syncForward({ enabled: true, host: '127.0.0.1', port }),
  ])
}

async function main(): Promise<void> {
  const port = await getFreePort()
  const manager = new ForwardManager({
    complete: async () => {},
    modelRows: () => [],
    forwardKey: () => 'test-key',
    log: () => {},
  })

  await triggerEnable(manager, port)
  const frag = manager.getStatusFragment()
  await manager.stop()

  assert.equal(frag.running, true, '代理应在运行')
  assert.equal(frag.error, undefined, '修复后 error 应为 undefined，竞态已消除')
  console.log(`ForwardManager: running=${frag.running} error=${JSON.stringify(frag.error ?? null)}`)
}

main()
  .then(() => {
    console.log('\n回归测试通过：ForwardManager in-flight 去重有效，phantom EADDRINUSE 不再出现。')
  })
  .catch((err: unknown) => {
    console.error('回归测试失败：', err instanceof Error ? err.message : err)
    process.exit(1)
  })
