/**
 * The local endpoint the free lane is repointed at.
 *
 * It answers the gateway's own paths and frame vocabulary, so `engine/http.js`,
 * `engine/adapter.js` and `engine/stream.js` need no changes at all: the lane's
 * base URL simply moves to `http://127.0.0.1:<port>` and everything downstream
 * of the socket keeps working. Errors come back in the gateway's envelope for the
 * same reason — the engine's classifier already knows how to read it.
 *
 * The listener goes up before the runtime is ready, and answers 503 until it is.
 * That is deliberate: the free lane's base URL is settled once, at start, and a
 * caller that arrives early gets a sentence it can show instead of a hang.
 *
 * @module src/main/llm-free/bridge/server.js
 */

import crypto from 'node:crypto'
import http from 'node:http'

import { BridgeTurnError, runTurn } from './translate.js'

const MAX_BODY_BYTES = 8 * 1024 * 1024

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** The gateway's error envelope, which `classifyFailure` reads. */
function gatewayError(res, status, type, message) {
  if (res.headersSent) {
    frame(res, { error: { message, type } })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }
  json(res, status, { error: { message, type, param: null, code: null } })
}

function openStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
}

function frame(res, payload) {
  if (res.destroyed) return
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** An aborted caller must stop the turn, not leave it running on the lane. */
function abortOnDisconnect(req, res) {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) controller.abort()
  }
  req.once('aborted', abort)
  req.socket?.once('close', abort)
  res.once('close', abort)
  if (req.aborted || req.destroyed || req.socket?.destroyed) abort()
  return controller
}

function chatFrames(res, model, result) {
  const id = `chatcmpl-${crypto.randomBytes(8).toString('hex')}`
  const created = Math.floor(Date.now() / 1000)
  const base = { id, object: 'chat.completion.chunk', created, model }
  frame(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
  if (result.reasoning !== '') {
    frame(res, { ...base, choices: [{ index: 0, delta: { reasoning: result.reasoning }, finish_reason: null }] })
  }
  if (result.text !== '') {
    frame(res, { ...base, choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }] })
  }
  if (result.usage !== undefined) frame(res, { ...base, choices: [], usage: result.usage })
  frame(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
}

/** Every emitter takes the same `(res, model, result)` triple, so the dispatch
 * table can hold all three without wrapping. */
function responsesFrames(res, model, result) {
  frame(res, { type: 'response.output_item.added', output_index: 0, item: { type: 'message', role: 'assistant' } })
  if (result.text !== '') frame(res, { type: 'response.output_text.delta', output_index: 0, delta: result.text })
  const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  frame(res, {
    type: 'response.completed',
    response: {
      status: 'completed',
      usage: {
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
      },
    },
  })
}

function messagesFrames(res, model, result) {
  frame(res, { type: 'message_start', message: { usage: { input_tokens: 0, output_tokens: 0 } } })
  frame(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: result.text } })
  frame(res, { type: 'message_delta', delta: { stop_reason: 'end_turn' } })
  frame(res, { type: 'message_stop' })
}

/**
 * Start the listener.
 *
 * @param {object} options
 * @param {{readiness: () => {ready: boolean, errorType: string, message: string},
 *   listModels: () => Promise<string[]>, serverUrl: () => string,
 *   noteFailure: (error: any) => void}} options.manager
 * @param {string} [options.host]
 * @param {number} [options.port]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{url: string, port: number, host: string, close: () => Promise<void>}>}
 */
export async function startBridgeServer({ manager, host = '127.0.0.1', port = 0, log = () => {} }) {
  const server = http.createServer((req, res) => {
    void handle(req, res).catch(error => {
      log(`request failed: ${error?.message ?? error}`)
      gatewayError(res, 500, 'UpstreamError', String(error?.message ?? error))
    })
  })

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (path === '/' || path === '/health') {
      const readiness = manager.readiness()
      json(res, 200, {
        ok: true,
        service: 'our-free-model-bridge',
        ready: readiness.ready,
        state: readiness.errorType,
        detail: readiness.message,
      })
      return
    }

    if (req.method === 'GET' && path === '/zen/v1/models') {
      try {
        const ids = await manager.listModels()
        json(res, 200, {
          object: 'list',
          data: ids.map(id => ({ id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'opencode' })),
        })
      } catch (error) {
        gatewayError(res, errorStatus(error), errorType(error), String(error?.message ?? error))
      }
      return
    }

    const wires = {
      '/zen/v1/chat/completions': chatFrames,
      '/zen/v1/responses': responsesFrames,
      '/zen/v1/messages': messagesFrames,
    }
    const emitter = req.method === 'POST' ? wires[path] : undefined
    if (emitter === undefined) {
      gatewayError(res, 404, 'NotFound', `no route for ${req.method} ${path}`)
      return
    }

    // Registered before the body is read, on purpose: a fully-consumed
    // IncomingMessage reports itself destroyed, so a disconnect check written
    // after `readBody` would abort every request the moment it starts.
    const controller = abortOnDisconnect(req, res)

    const body = await readBody(req)
    const model = String(body?.model ?? '').trim()
    if (model === '') {
      gatewayError(res, 400, 'InvalidRequest', '`model` is required')
      return
    }
    const readiness = manager.readiness()
    if (!readiness.ready) {
      gatewayError(res, 503, readiness.errorType, readiness.message)
      return
    }

    // An id the runtime does not route is refused here rather than let through:
    // opencode answers an unknown model with a generic 500, which the engine can
    // only read as "something went wrong", while `ModelError` is the reading that
    // drops the id from the picker.
    try {
      const known = await manager.listModels()
      if (known.length > 0 && !known.includes(model)) {
        gatewayError(res, 404, 'ModelError', `model is unavailable: ${model}`)
        return
      }
    } catch {
      // The catalogue is an optimisation; a turn still has to be attemptable.
    }

    openStream(res)
    try {
      const result = await runTurn({
        serverUrl: manager.serverUrl(),
        model,
        openAi: body,
        signal: controller.signal,
      })
      emitter(res, model, result)
    } catch (error) {
      manager.noteFailure(error)
      frame(res, { error: { message: String(error?.message ?? error), type: errorType(error) } })
    } finally {
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }

  const bound = await new Promise((resolve, reject) => {
    const onError = error => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      server.on('error', error => log(`bridge listener error: ${error?.message ?? error}`))
      resolve(server.address()?.port ?? 0)
    })
  })

  return {
    url: `http://${host}:${bound}`,
    port: bound,
    host,
    close: () => new Promise(resolve => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}

function errorStatus(error) {
  return error instanceof BridgeTurnError ? error.status : 502
}

function errorType(error) {
  return error instanceof BridgeTurnError ? error.type : 'UpstreamError'
}
