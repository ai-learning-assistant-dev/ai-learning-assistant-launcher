/**
 * On-demand fetch of the opencode runtime binary.
 *
 * The free lane's gate asks "are you the OpenCode client", so the lane cannot be
 * driven by a bare HTTP client no matter what credential it presents. The
 * official binary is therefore a runtime dependency — but a 170 MB one, which is
 * why it is fetched into the user's data directory on first use instead of being
 * shipped inside the installer.
 *
 * The registry is configurable so a slow or blocked npmjs can be pointed at a
 * mirror. Whatever the source, the tarball is verified against the registry's own
 * sha512 before anything is extracted from it.
 *
 * @module src/main/llm-free/bridge/binary.js
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'

import { extractEntry } from './tar.js'

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
/** The wrapper package whose optionalDependencies carry the platform binaries. */
export const WRAPPER_PACKAGE = 'opencode-ai'

const DOWNLOAD_PERCENT = 88

/**
 * Platform package names, best first.
 *
 * The `-baseline` build is the same program compiled without AVX2, which is what
 * a CPU old enough to lack it needs to avoid dying on the first instruction.
 *
 * @returns {string[]}
 */
export function platformPackages() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const name = `opencode-${platform}-${arch}`
  return [name, `${name}-baseline`]
}

/** The executable's file name on this platform. */
export function executableName() {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode'
}

/** Where installed versions live inside the launcher's data directory. */
export function installRoot(dataDir) {
  return path.join(dataDir, 'opencode')
}

/**
 * Find a usable binary: the operator's explicit path first, then the newest
 * version this launcher installed itself.
 *
 * @param {string} dataDir
 * @param {string} [manualPath]
 * @returns {string} the path, or '' when there is nothing to run yet
 */
export function findBinary(dataDir, manualPath = '') {
  const manual = String(manualPath ?? '').trim()
  if (manual !== '' && fs.existsSync(manual)) return manual
  const root = installRoot(dataDir)
  let versions = []
  try {
    versions = fs.readdirSync(root)
  } catch {
    return ''
  }
  const name = executableName()
  for (const version of versions.sort().reverse()) {
    const candidate = path.join(root, version, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return ''
}

function registryBase(registry) {
  const raw = String(registry ?? '').trim()
  return (raw === '' ? DEFAULT_REGISTRY : raw).replace(/\/+$/, '')
}

function packumentUrl(base, name) {
  const trimmed = String(name).trim()
  if (trimmed.startsWith('@')) {
    const [scope, rest] = trimmed.split('/')
    return `${base}/${scope}/${rest ?? ''}`
  }
  return `${base}/${encodeURIComponent(trimmed)}`
}

async function fetchJson(url, { signal, timeoutMs = 30000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`registry answered HTTP ${response.status} for ${url}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Resolve a package version to its tarball URL and expected digest.
 *
 * @param {{registry?: string, packageName: string, version?: string, signal?: AbortSignal}} options
 * @returns {Promise<{version: string, tarball: string, integrity: string}>}
 */
export async function resolvePackage({ registry, packageName, version, signal }) {
  const meta = await fetchJson(packumentUrl(registryBase(registry), packageName), { signal })
  const wanted = String(version ?? '').trim()
  const chosen = wanted === '' ? meta?.['dist-tags']?.latest : wanted
  const entry = chosen === undefined ? undefined : meta?.versions?.[chosen]
  if (entry === undefined) {
    throw new Error(`${packageName} has no published version ${chosen ?? '(latest)'}`)
  }
  const tarball = entry?.dist?.tarball
  if (typeof tarball !== 'string' || tarball === '') {
    throw new Error(`${packageName}@${chosen} carries no tarball url`)
  }
  return { version: String(chosen), tarball, integrity: String(entry?.dist?.integrity ?? '') }
}

/** Does the computed digest match the registry's `sha512-…` string? */
export function integrityMatches(integrity, digestBase64) {
  const expected = /^sha512-(.+)$/.exec(String(integrity ?? '').trim())
  if (expected === null) return true
  const a = Buffer.from(expected[1], 'base64')
  const b = Buffer.from(digestBase64, 'base64')
  return a.byteLength === b.byteLength && crypto.timingSafeEqual(a, b)
}

async function downloadTo(url, destPath, { signal, onProgress }) {
  const response = await fetch(url, { signal, redirect: 'follow' })
  if (!response.ok || response.body === null) {
    throw new Error(`tarball download failed: HTTP ${response.status}`)
  }
  const total = Number(response.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha512')
  const out = fs.createWriteStream(destPath)
  const reader = response.body.getReader()
  let loaded = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value === undefined) continue
      const buffer = Buffer.from(value)
      hash.update(buffer)
      loaded += buffer.byteLength
      if (!out.write(buffer)) await once(out, 'drain')
      const percent = total > 0 ? Math.min(DOWNLOAD_PERCENT, Math.round((loaded / total) * DOWNLOAD_PERCENT)) : 0
      onProgress({ phase: 'download', loaded, total, percent })
    }
    out.end()
    await once(out, 'finish')
  } catch (error) {
    out.destroy()
    await reader.cancel().catch(() => {})
    throw error
  }
  return { bytes: loaded, digest: hash.digest('base64') }
}

async function installOne({ dataDir, registry, packageName, version, signal, onProgress, log }) {
  const resolved = await resolvePackage({ registry, packageName, version, signal })
  const targetDir = path.join(installRoot(dataDir), resolved.version)
  const target = path.join(targetDir, executableName())
  if (fs.existsSync(target)) {
    onProgress({ phase: 'cached', loaded: 0, total: 0, percent: 100 })
    return { path: target, version: resolved.version, packageName, reused: true }
  }

  fs.mkdirSync(targetDir, { recursive: true })
  const partial = path.join(installRoot(dataDir), `${resolved.version}.part.tgz`)
  log(`downloading ${packageName}@${resolved.version}`)
  try {
    const { digest } = await downloadTo(resolved.tarball, partial, { signal, onProgress })
    if (!integrityMatches(resolved.integrity, digest)) {
      throw new Error(`${packageName}@${resolved.version} failed integrity check`)
    }
    onProgress({ phase: 'extract', loaded: 0, total: 0, percent: DOWNLOAD_PERCENT })
    const wanted = `package/bin/${executableName()}`
    const extracted = await extractEntry(fs.createReadStream(partial), {
      match: name => name === wanted || name.endsWith(`/bin/${executableName()}`),
      destPath: target,
      onProgress: written => onProgress({
        phase: 'extract',
        loaded: written,
        total: 0,
        percent: Math.min(100, DOWNLOAD_PERCENT + Math.round(written / (1024 * 1024 * 2))),
      }),
    })
    if (!extracted.found) throw new Error(`${packageName}@${resolved.version} contains no ${wanted}`)
    fs.chmodSync(target, 0o755)
    onProgress({ phase: 'extract', loaded: extracted.bytes, total: 0, percent: 100 })
    return { path: target, version: resolved.version, packageName, bytes: extracted.bytes, reused: false }
  } catch (error) {
    fs.rmSync(target, { force: true })
    throw error
  } finally {
    fs.rmSync(partial, { force: true })
  }
}

/**
 * Make a runnable binary available, downloading it when nothing is installed.
 *
 * @param {object} options
 * @param {string} options.dataDir - the launcher's data directory
 * @param {string} [options.registry] - npm registry or mirror
 * @param {string} [options.version] - pinned version; '' takes the newest
 * @param {AbortSignal} [options.signal]
 * @param {(progress: {phase: string, loaded: number, total: number, percent: number}) => void} [options.onProgress]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{path: string, version: string, packageName: string, reused: boolean}>}
 */
export async function installBinary({ dataDir, registry, version, signal, onProgress = () => {}, log = () => {} }) {
  fs.mkdirSync(installRoot(dataDir), { recursive: true })
  let lastError
  for (const packageName of platformPackages()) {
    try {
      return await installOne({ dataDir, registry, packageName, version, signal, onProgress, log })
    } catch (error) {
      lastError = error
      log(`${packageName} not usable: ${error?.message ?? error}`)
      if (signal?.aborted === true) throw error
    }
  }
  throw lastError ?? new Error('no platform build of the opencode runtime is available')
}
