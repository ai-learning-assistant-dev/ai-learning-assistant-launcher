/**
 * Lifecycle of the headless opencode server the free lane is spoken through.
 *
 * The child runs against a private home directory under the launcher's data
 * directory, for two reasons that are both about not colliding with the user:
 * their own `opencode` install keeps its config and credentials untouched, and
 * the sandbox policy this process needs — the tool declarations must stay on the
 * wire or the lane refuses the turn, so execution has to be denied in
 * configuration rather than by removing the tools — can be written without
 * editing anything of theirs.
 *
 * @module src/main/llm-free/bridge/runtime.js
 */

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'

const READY_TIMEOUT_MS = 60000
const READY_POLL_MS = 250

/**
 * The deny policy.
 *
 * Verified against the lane: with these in place a turn that asks the model to
 * run a shell command still answers 200 — the gate fingerprints the *declared*
 * tool set, not the permitted one — and the command is not executed. Keys are
 * deliberately limited to the three that were confirmed to load.
 */
const SANDBOX_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  permission: {
    bash: 'deny',
    edit: 'deny',
    webfetch: 'deny',
  },
}

/** The child's private home inside the data directory. */
export function bridgeHome(dataDir) {
  return path.join(dataDir, 'opencode-home')
}

function prepareHome(dataDir) {
  const home = bridgeHome(dataDir)
  const configDir = path.join(home, '.config', 'opencode')
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(path.join(home, 'work'), { recursive: true })
  fs.writeFileSync(path.join(configDir, 'opencode.json'), JSON.stringify(SANDBOX_CONFIG, null, 2))
  return home
}

/** A port nobody is holding, released immediately before the child claims it. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    child.once('exit', done)
    try {
      child.kill('SIGTERM')
    } catch {
      done()
    }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          } else {
            child.kill('SIGKILL')
          }
        } catch {
          // best effort — the exit listener still settles this promise
        }
      }
      setTimeout(done, 1500).unref?.()
    }, 2500).unref?.()
  })
}

/**
 * Confirm the deny policy actually took effect.
 *
 * A config that failed to load would leave the model able to run commands while
 * every request still answered 200 — the exact failure that must not be silent.
 *
 * @param {any} config - the body of `GET /config`
 * @returns {string} '' when the policy is in force, otherwise why it is not
 */
export function sandboxProblem(config) {
  const permission = config?.permission
  if (permission === undefined || permission === null) return ''
  for (const key of ['bash', 'edit', 'webfetch']) {
    if (String(permission[key] ?? '').toLowerCase() !== 'deny') {
      return `opencode ignored the deny policy for the ${key} tool`
    }
  }
  return ''
}

async function waitReady(url, { child, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no answer yet'
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`opencode exited with code ${child.exitCode ?? child.signalCode}`)
    }
    try {
      const response = await fetch(`${url}/config`, { signal: AbortSignal.timeout(4000) })
      if (response.ok) return await response.json().catch(() => ({}))
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error?.message ?? String(error)
    }
    await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
  }
  throw new Error(`opencode did not answer on ${url} within ${Math.round(timeoutMs / 1000)}s (${lastError})`)
}

/**
 * Start the headless server and wait until it answers.
 *
 * @param {object} options
 * @param {string} options.binaryPath
 * @param {string} options.dataDir
 * @param {number} [options.port] - 0 picks a free port
 * @param {(message: string) => void} [options.log]
 * @param {(message: string) => void} [options.warn]
 * @returns {Promise<{port: number, url: string, pid: number|undefined, stop: () => Promise<void>}>}
 */
export async function startServer({ binaryPath, dataDir, port = 0, log = () => {}, warn = () => {} }) {
  const home = prepareHome(dataDir)
  const chosen = Number.isFinite(port) && port > 0 ? port : await freePort()
  const url = `http://127.0.0.1:${chosen}`

  const child = spawn(
    binaryPath,
    ['serve', '--hostname=127.0.0.1', '--port', String(chosen), '--print-logs', '--log-level=ERROR'],
    {
      cwd: path.join(home, 'work'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        NO_COLOR: '1',
      },
    },
  )

  let stderrTail = ''
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', chunk => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000)
  })
  child.on('error', error => warn(`opencode could not be spawned: ${error.message}`))

  try {
    const config = await waitReady(url, { child, timeoutMs: READY_TIMEOUT_MS })
    const problem = sandboxProblem(config)
    if (problem !== '') throw new Error(problem)
    log(`opencode runtime listening on ${url} (pid ${child.pid})`)
    return { port: chosen, url, pid: child.pid, stop: () => stopChild(child) }
  } catch (error) {
    await stopChild(child)
    const tail = stderrTail.trim().split('\n').slice(-3).join(' | ')
    throw new Error(`${error?.message ?? error}${tail === '' ? '' : ` — ${tail}`}`)
  }
}
