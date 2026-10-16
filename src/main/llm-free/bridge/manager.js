/**
 * Owns the free lane's new outbound leg.
 *
 * The lane refuses a bare HTTP client — the gate is on client identity, not on
 * credentials — so every free-lane request now leaves through a headless opencode
 * runtime instead of going to the gateway directly. This class is the piece that
 * makes that swap invisible to the rest of the launcher: it brings up the local
 * endpoint the lane is repointed at, prepares the runtime behind it, and reports
 * one status fragment for the settings panel.
 *
 * The repointing is the whole trick. `engine/http.js` sends every request to
 * `UPSTREAM_BASE` and nothing else, so moving that base from the gateway to
 * `http://127.0.0.1:<port>` reroutes the entire lane — request bodies, SSE
 * parsing, tool fingerprinting, the forward proxy — without editing any of it.
 *
 * @module src/main/llm-free/bridge/manager.js
 */

import path from 'node:path'

import { setUpstreamBase } from '../engine/upstream.js'
import { findBinary, installBinary, installRoot } from './binary.js'
import { startServer } from './runtime.js'
import { startBridgeServer } from './server.js'
import { BridgeTurnError } from './translate.js'

/**
 * The states the settings panel renders.
 *
 * Declared as an explicit literal union rather than derived from the object
 * below: `typeof X[keyof typeof X]` does not reliably narrow in JSDoc and
 * degrades to `string`, which then fails the `BridgeState` field it is assigned
 * to in the service that consumes this fragment.
 *
 * @typedef {'off' | 'downloading' | 'starting' | 'running' | 'error'} BridgeState
 */

/** States the settings panel renders. */
export const BRIDGE_STATE = Object.freeze({
  off: 'off',
  downloading: 'downloading',
  starting: 'starting',
  running: 'running',
  error: 'error',
})

const MODEL_CACHE_MS = 5 * 60 * 1000

/** Is `candidate` inside `parent`? Path comparison, case-insensitive on Windows. */
function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export class BridgeManager {
  /**
   * @param {object} options
   * @param {string} options.dataDir - the launcher's data directory
   * @param {(message: string) => void} [options.log]
   * @param {(message: string) => void} [options.warn]
   * @param {() => void} [options.onReady] - fired on each transition into
   *   `running`, so the caller can refresh the catalog that failed while the
   *   runtime was still coming up
   */
  constructor({ dataDir, log = () => {}, warn = () => {}, onReady = () => {} }) {
    this.dataDir = dataDir
    this.log = log
    this.warn = warn
    this.onReady = onReady

    this.server = null
    this.runtime = null
    /** @type {BridgeState} */
    this.state = BRIDGE_STATE.off
    this.percent = 0
    this.message = ''
    this.version = ''
    this.binaryPath = ''
    this.serverPort = 0

    this.models = []
    this.modelsAt = 0
    this.syncPromise = null
    this.preparePromise = null
    this.abort = new AbortController()
  }

  /**
   * Bring the bridge up, or take it down, to match the caller's wish.
   *
   * Returns as soon as the local endpoint exists — never after the download.
   * Preparing the runtime is deliberately off the critical path: a first run
   * fetches ~170 MB, and blocking the launcher's start-up on that would be worse
   * than serving a 503 that says what is happening.
   *
   * @param {{enabled: boolean, registry?: string, version?: string, binaryPath?: string, port?: number}} desired
   */
  sync(desired) {
    if (this.syncPromise !== null) return this.syncPromise
    const run = (async () => {
      try {
        return await this.apply(desired)
      } finally {
        this.syncPromise = null
      }
    })()
    this.syncPromise = run
    return run
  }

  async apply(desired) {
    if (desired?.enabled !== true) {
      await this.teardown()
      this.state = BRIDGE_STATE.off
      this.percent = 0
      this.message = ''
      return this.getStatusFragment()
    }

    if (this.server === null) {
      this.abort = new AbortController()
      this.server = await startBridgeServer({
        manager: this,
        log: message => this.log(`bridge: ${message}`),
      })
      this.serverPort = this.server.port
      setUpstreamBase(this.server.url)
      this.log(`free lane repointed at ${this.server.url}`)
    }

    if (this.state === BRIDGE_STATE.running || this.preparePromise !== null) {
      return this.getStatusFragment()
    }

    this.preparePromise = this.prepare(desired).finally(() => { this.preparePromise = null })
    return this.getStatusFragment()
  }

  async prepare(desired) {
    const signal = this.abort.signal
    try {
      let binary = findBinary(this.dataDir, desired.binaryPath)
      if (binary === '') {
        this.setProgress(BRIDGE_STATE.downloading, 0, '正在获取 opencode 运行时…')
        const installed = await installBinary({
          dataDir: this.dataDir,
          registry: desired.registry,
          version: desired.version,
          signal,
          onProgress: progress => this.setProgress(
            BRIDGE_STATE.downloading,
            progress.percent,
            progress.phase === 'extract'
              ? '正在解压 opencode 运行时…'
              : `正在下载 opencode 运行时 ${progress.percent}%`,
          ),
          log: message => this.log(message),
        })
        binary = installed.path
        this.version = installed.version
      } else {
        // A binary this launcher installed is versioned by its directory name;
        // one the operator pointed at has no version we can claim.
        this.version = isInside(installRoot(this.dataDir), binary) ? path.basename(path.dirname(binary)) : ''
      }
      this.binaryPath = binary

      this.setProgress(BRIDGE_STATE.starting, 100, '正在启动 opencode 运行时…')
      this.runtime = await startServer({
        binaryPath: binary,
        dataDir: this.dataDir,
        port: desired.port,
        log: message => this.log(message),
        warn: message => this.warn(message),
      })
      this.state = BRIDGE_STATE.running
      this.percent = 100
      this.message = ''
      this.log('the free lane is now served through the opencode runtime')
      try {
        this.onReady()
      } catch {
        // A failing listener must not take the bridge down with it.
      }
    } catch (error) {
      this.state = BRIDGE_STATE.error
      this.percent = 0
      this.message = String(error?.message ?? error)
      this.warn(`bridge could not start: ${this.message}`)
    }
  }

  /**
   * @param {BridgeState} state
   * @param {number} percent
   * @param {string} message
   */
  setProgress(state, percent, message) {
    this.state = state
    this.percent = Number.isFinite(percent) ? percent : 0
    this.message = message
  }

  /** Whether a request can be served right now, and what to say when it cannot. */
  readiness() {
    if (this.state === BRIDGE_STATE.running && this.runtime !== null) {
      return { ready: true, errorType: '', message: '' }
    }
    if (this.state === BRIDGE_STATE.error) {
      return {
        ready: false,
        errorType: 'BridgeUnavailable',
        message: `免密免费模型桥接不可用：${this.message}`,
      }
    }
    const detail = this.state === BRIDGE_STATE.downloading ? `${this.percent}%` : String(this.state)
    return {
      ready: false,
      errorType: 'BridgeNotReady',
      message: `免密免费模型桥接正在准备（${detail}）${this.message === '' ? '' : ` — ${this.message}`}`,
    }
  }

  serverUrl() {
    return this.runtime === null ? '' : this.runtime.url
  }

  /**
   * The models the runtime's own provider exposes.
   *
   * The catalog still filters this down to the free lane; asking the runtime
   * rather than the gateway keeps the listing consistent with what a turn will
   * actually be routed to.
   *
   * @returns {Promise<string[]>}
   */
  async listModels() {
    const readiness = this.readiness()
    if (!readiness.ready) throw new BridgeTurnError(readiness.message, 503, readiness.errorType)
    if (this.models.length > 0 && Date.now() - this.modelsAt < MODEL_CACHE_MS) return this.models
    const response = await fetch(`${this.runtime.url}/provider`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      throw new BridgeTurnError(`opencode answered HTTP ${response.status} for its model list`, 502, 'UpstreamError')
    }
    const payload = await response.json()
    const providers = Array.isArray(payload?.all) ? payload.all : []
    const lane = providers.find(provider => provider?.id === 'opencode')
    const ids = lane === undefined ? [] : Object.keys(lane.models ?? {})
    this.models = ids
    this.modelsAt = Date.now()
    return ids
  }

  /**
   * Notice a runtime that died under us.
   *
   * Only transport-shaped failures count: a refusal from the lane is an answer,
   * and the runtime is still perfectly alive after giving one.
   */
  noteFailure(error) {
    const message = String(error?.message ?? error)
    if (!/ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|other side closed|UND_ERR/i.test(message)) return
    this.runtime = null
    this.state = BRIDGE_STATE.error
    this.percent = 0
    this.message = message
    this.warn(`bridge runtime is gone: ${message}`)
  }

  async teardown() {
    this.abort.abort()
    this.preparePromise = null
    if (this.server !== null) {
      const closing = this.server
      this.server = null
      await closing.close().catch(() => {})
    }
    if (this.runtime !== null) {
      const runtime = this.runtime
      this.runtime = null
      await runtime.stop().catch(() => {})
    }
    this.serverPort = 0
    this.models = []
    this.modelsAt = 0
  }

  /** Take the bridge down; used on disable and on quit. */
  async stop() {
    await this.teardown()
    this.state = BRIDGE_STATE.off
    this.percent = 0
    this.message = ''
  }

  /**
   * The slice of `FreeProviderStatus` this class owns.
   *
   * @returns {{state: BridgeState, percent: number, version: string,
   *   binaryPath: string, serverPort: number, message: string}}
   */
  getStatusFragment() {
    return {
      state: this.state,
      percent: this.percent,
      version: this.version,
      binaryPath: this.binaryPath,
      serverPort: this.serverPort,
      message: this.message,
    }
  }
}
