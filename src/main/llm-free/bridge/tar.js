/**
 * Minimal tar reader for npm package tarballs.
 *
 * Only one entry ever has to come out of a package tarball — the platform
 * binary — so this implements the slice of the format npm actually produces and
 * nothing else: ustar headers, the `prefix` field, the pax records that precede
 * a path too long for the 100-byte name field, and the zero-block end marker.
 * Every other entry is stepped over by its own size field.
 *
 * Written by hand rather than pulled in: this runs inside the packaged main
 * process, where a new dependency is something webpack has to resolve and a
 * future npm install can break. The archive's own integrity is checked against
 * the registry's sha512 before any of this runs, so the header checksum that a
 * conforming reader would verify is redundant here.
 *
 * @module src/main/llm-free/bridge/tar.js
 */

import fs from 'node:fs'
import { once } from 'node:events'
import { createGunzip } from 'node:zlib'

const BLOCK = 512
/** A pax record is small; anything larger is not the path override we want. */
const MAX_PAX_BYTES = 64 * 1024

/** Null-terminated (or field-width) ASCII text. */
function text(block, start, length) {
  const end = block.indexOf(0, start)
  const stop = end === -1 || end > start + length ? start + length : end
  return block.toString('latin1', start, stop).trim()
}

/** Octal numeric field, with the GNU base-256 escape for oversized values. */
function numeric(block, start, length) {
  if ((block[start] & 0x80) !== 0) {
    let value = block[start] & 0x7f
    for (let i = start + 1; i < start + length; i += 1) value = value * 256 + block[i]
    return value
  }
  const raw = text(block, start, length).replace(/[^0-7]/g, '')
  return raw === '' ? 0 : Number.parseInt(raw, 8)
}

/**
 * Parse one 512-byte header block.
 *
 * @param {Buffer} block
 * @returns {{name: string, size: number, type: string} | null} null at the
 *   end-of-archive marker, where the whole block is zero
 */
export function parseHeader(block) {
  let blank = true
  for (let i = 0; i < BLOCK; i += 1) {
    if (block[i] !== 0) { blank = false; break }
  }
  if (blank) return null
  const name = text(block, 0, 100)
  const prefix = text(block, 345, 155)
  return {
    name: prefix === '' ? name : `${prefix}/${name}`,
    size: numeric(block, 124, 12),
    type: String.fromCharCode(block[156] || 0x30),
  }
}

/** Pull the `path=` override out of a pax extended header payload. */
export function parsePaxPath(record) {
  const match = /(?:^|\n)\d+ path=([^\n]+)/.exec(`\n${record}`)
  return match === null ? '' : match[1]
}

/**
 * Stream one named entry out of a gzipped tarball.
 *
 * @param {import('node:stream').Readable} source - the `.tgz` byte stream
 * @param {object} options
 * @param {(name: string) => boolean} options.match - which entry to keep
 * @param {string} options.destPath - where to write it
 * @param {(written: number) => void} [options.onProgress]
 * @returns {Promise<{found: boolean, bytes: number, path: string}>}
 */
export async function extractEntry(source, { match, destPath, onProgress = () => {} }) {
  const gunzip = createGunzip()
  source.pipe(gunzip)

  let pending = Buffer.alloc(0)
  /** 'header' | 'write' | 'skip' | 'pax' */
  let mode = 'header'
  let remaining = 0
  let captured = 0
  let capLimit = 0
  let written = 0
  let out = null
  let pax = ''
  let paxName = ''
  let found = false

  const closeEntry = async () => {
    mode = 'header'
    if (out === null) return
    const stream = out
    out = null
    stream.end()
    await once(stream, 'finish')
  }

  try {
    for await (const chunk of gunzip) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      for (;;) {
        if (mode === 'header') {
          if (pending.length < BLOCK) break
          const header = parseHeader(pending.subarray(0, BLOCK))
          pending = pending.subarray(BLOCK)
          if (header === null) {
            await closeEntry()
            return { found, bytes: written, path: destPath }
          }
          // pax records carry the real path of the entry that follows them.
          if (header.type === 'x' || header.type === 'g') {
            pax = ''
            captured = 0
            capLimit = Math.min(header.size, MAX_PAX_BYTES)
            remaining = Math.ceil(header.size / BLOCK) * BLOCK
            mode = 'pax'
            continue
          }
          const name = paxName === '' ? header.name : paxName
          paxName = ''
          if (match(name) && header.type !== '5') {
            out = fs.createWriteStream(destPath)
            found = true
            written = 0
            remaining = header.size
            if (remaining === 0) {
              await closeEntry()
              return { found, bytes: written, path: destPath }
            }
            mode = 'write'
          } else {
            remaining = Math.ceil(header.size / BLOCK) * BLOCK
            mode = 'skip'
          }
          continue
        }

        if (pending.length === 0) break
        const take = Math.min(remaining, pending.length)
        if (take > 0) {
          if (mode === 'write') {
            if (!out.write(pending.subarray(0, take))) await once(out, 'drain')
            written += take
            onProgress(written)
          } else if (mode === 'pax' && captured < capLimit) {
            const usable = Math.min(take, capLimit - captured)
            pax += pending.subarray(0, usable).toString('utf8')
            captured += usable
          }
          pending = pending.subarray(take)
          remaining -= take
        }
        if (remaining > 0) continue
        if (mode === 'pax') {
          paxName = parsePaxPath(pax)
          pax = ''
          mode = 'header'
          continue
        }
        await closeEntry()
        // A skipped entry — a directory, or anything else in the archive — also
        // ends with nothing left to read, and a zero-length one ends immediately.
        // Only the entry we came for finishes the scan; the rest must not.
        if (found) return { found, bytes: written, path: destPath }
        continue
      }
    }
    await closeEntry()
    return { found, bytes: written, path: destPath }
  } catch (error) {
    if (out !== null) out.destroy()
    gunzip.destroy()
    throw error
  }
}
