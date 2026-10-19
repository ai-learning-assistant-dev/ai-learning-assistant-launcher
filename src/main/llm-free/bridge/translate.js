/**
 * Translation between the OpenAI shapes this launcher speaks and the opencode
 * server's own session API.
 *
 * Two things about that API shape the code below.
 *
 * The lane's gate is on the *declared tool set*: a request that drops the
 * bash/glob/grep/read quartet is refused with the same 403 a bare HTTP client
 * gets, so tools cannot be withheld to keep the model harmless. Harmlessness is
 * configured instead — see `runtime.js`, which denies execution while leaving the
 * declarations on the wire. Only tools that are safe to remove are removed here.
 *
 * There is no incremental output on this path: a whole generation lands in the
 * message's `parts` in one step (measured — 707 characters arrived as a single
 * part update), so a turn is executed to completion and then framed out as the
 * caller's wire expects.
 *
 * @module src/main/llm-free/bridge/translate.js
 */

/** Tools removed on top of the runtime's deny policy, as belt and braces. */
const REMOVABLE_TOOLS = ['edit', 'write', 'patch', 'apply_patch', 'task', 'webfetch', 'websearch', 'todowrite', 'question', 'skill']

/** Refusals from the lane, in the wire vocabulary the engine already classifies. */
const REFUSAL_TYPES = [
  { test: /free tier can only be used from within/i, type: 'FreeTierError' },
  { test: /not available in your country|\bregion\b/i, type: 'RegionError' },
  { test: /usage limit|rate limit/i, type: 'FreeUsageLimitError' },
  { test: /model is unavailable|not supported|no such model|unknown model/i, type: 'ModelError' },
]

/** A turn that cannot be served, carrying the status the gateway would have used. */
export class BridgeTurnError extends Error {
  constructor(message, status, type) {
    super(message)
    this.name = 'BridgeTurnError'
    this.status = status
    this.type = type
  }
}

/**
 * The tool map handed to the session.
 *
 * The quartet is deliberately absent: it has to stay enabled or the lane refuses
 * the turn. Everything listed here can be switched off without tripping the gate
 * (verified by request, one variant at a time).
 */
export function toolPolicy() {
  const policy = {}
  for (const name of REMOVABLE_TOOLS) policy[name] = false
  return policy
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const out = []
  for (const part of content) {
    if (typeof part === 'string') { out.push(part); continue }
    if (part === null || typeof part !== 'object') continue
    // `text` is the Chat spelling, `input_text` the Responses one.
    if ((part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string') out.push(part.text)
    else if (part.type === 'image_url' || part.type === 'input_image') out.push('[image]')
  }
  return out.join('\n')
}

/**
 * The message list, from either OpenAI dialect.
 *
 * A Chat request carries `messages`; a Responses request carries `input` whose
 * items nest their text one level deeper. The engine's own responses calls use
 * the second shape, so accepting only the first would refuse every muse-spark
 * turn with "no user message".
 *
 * @param {any} body
 * @returns {Array<{role?: string, content?: any}>}
 */
export function messagesFrom(body) {
  if (Array.isArray(body?.messages) && body.messages.length > 0) return body.messages
  if (Array.isArray(body?.input)) {
    return body.input.map(item => ({
      role: item?.role ?? 'user',
      content: Array.isArray(item?.content)
        ? item.content.map(part => (part !== null && typeof part === 'object' ? part.text ?? '' : part)).filter(value => typeof value === 'string')
        : item?.content ?? '',
    }))
  }
  return []
}

const ROLE_LABEL = { system: 'system', developer: 'system', user: 'user', assistant: 'assistant', tool: 'tool' }

/**
 * Collapse an OpenAI message list into one system prompt and one prompt.
 *
 * A conversation longer than a single user turn is rendered as a labelled
 * transcript rather than replayed as turns: the session is created fresh for each
 * request, so the transcript is the only thing that carries the history.
 *
 * @param {any} body - the OpenAI-shaped request body
 * @returns {{system: string, text: string}}
 */
export function toPrompt(body) {
  const messages = messagesFrom(body)
  const systemParts = []
  const turns = []
  for (const message of messages) {
    const text = contentText(message?.content).trim()
    if (text === '') continue
    const role = String(message?.role ?? 'user')
    if (role === 'system' || role === 'developer') {
      systemParts.push(text)
      continue
    }
    turns.push({ role, text })
  }
  const system = systemParts.join('\n\n')
  if (turns.length === 0) return { system, text: '' }
  if (turns.length === 1) return { system, text: turns[0].text }
  const last = ROLE_LABEL[turns[turns.length - 1].role] ?? 'user'
  const transcript = turns.map(turn => `# ${ROLE_LABEL[turn.role] ?? turn.role}\n${turn.text}`).join('\n\n')
  return { system, text: `The conversation so far is below. Answer the final ${last} turn.\n\n${transcript}` }
}

function typeOf(message, status) {
  for (const rule of REFUSAL_TYPES) if (rule.test.test(message)) return rule.type
  if (status === 429) return 'FreeUsageLimitError'
  return 'UpstreamError'
}

function turnErrorOf(error) {
  const data = error?.data ?? {}
  const message = String(data.message ?? error?.message ?? 'the free lane refused the turn')
  const status = Number.isInteger(data.statusCode) ? data.statusCode : 502
  return new BridgeTurnError(message, status, typeOf(message, status))
}

/**
 * Collect `session.error` events for one session.
 *
 * The refusal is not in the message response — an aborted turn comes back with
 * empty `parts` and the reason is only published on the event stream. Without
 * this the failure would surface as an empty answer.
 *
 * @returns {() => void} stop watching
 */
function watchSessionErrors(serverUrl, sessionId, bucket, signal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const task = (async () => {
    try {
      const response = await fetch(`${serverUrl}/event`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) return
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        let index = buffer.indexOf('\n')
        while (index !== -1) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (line.startsWith('data:')) absorb(line.slice(5).trim(), sessionId, bucket)
          index = buffer.indexOf('\n')
        }
      }
    } catch {
      // The stream ends when the turn does, or when the caller aborts.
    }
  })()
  return () => {
    controller.abort()
    signal?.removeEventListener('abort', onAbort)
    void task.catch(() => {})
  }
}

function absorb(payload, sessionId, bucket) {
  if (payload === '') return
  let event
  try {
    event = JSON.parse(payload)
  } catch {
    return
  }
  if (event?.type !== 'session.error') return
  const properties = event.properties ?? {}
  if (properties.sessionID !== sessionId) return
  bucket.push(turnErrorOf(properties.error))
}

function timedFetch(url, init, timeoutMs, outerSignal) {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = outerSignal === undefined || outerSignal === null ? deadline : AbortSignal.any([outerSignal, deadline])
  return fetch(url, { ...init, signal })
}

async function openSession(serverUrl, signal) {
  const response = await timedFetch(`${serverUrl}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }, 30000, signal)
  if (!response.ok) {
    throw new BridgeTurnError(`opencode refused to open a session (HTTP ${response.status})`, 502, 'UpstreamError')
  }
  const session = await response.json()
  const id = session?.id
  if (typeof id !== 'string' || id === '') {
    throw new BridgeTurnError('opencode returned no session id', 502, 'UpstreamError')
  }
  return id
}

function usageOf(message) {
  const tokens = message?.info?.tokens
  if (tokens === undefined || tokens === null) return undefined
  const input = Number(tokens.input) || 0
  const output = Number(tokens.output) || 0
  return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output }
}

/**
 * Run one completion through the runtime.
 *
 * @param {object} options
 * @param {string} options.serverUrl - the headless server's base URL
 * @param {string} options.model - provider model id
 * @param {any} options.openAi - the OpenAI-shaped request body
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{text: string, reasoning: string, usage: object|undefined}>}
 */
export async function runTurn({ serverUrl, model, openAi, signal, timeoutMs = 300000 }) {
  const { system, text } = toPrompt(openAi)
  if (text === '') throw new BridgeTurnError('the request carried no user message', 400, 'InvalidRequest')

  const session = await openSession(serverUrl, signal)
  const errors = []
  const stopWatching = watchSessionErrors(serverUrl, session, errors, signal)

  try {
    const payload = {
      model: { providerID: 'opencode', modelID: model },
      tools: toolPolicy(),
      parts: [{ type: 'text', text }],
    }
    if (system !== '') payload.system = system

    const response = await timedFetch(`${serverUrl}/session/${session}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, timeoutMs, signal)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new BridgeTurnError(`opencode answered HTTP ${response.status} for the turn: ${detail.slice(0, 300)}`, 502, 'UpstreamError')
    }

    const message = await response.json()
    const parts = Array.isArray(message?.parts) ? message.parts : []
    const answer = parts.filter(part => part?.type === 'text').map(part => String(part.text ?? '')).join('')
    const reasoning = parts.filter(part => part?.type === 'reasoning').map(part => String(part.text ?? '')).join('')
    if (answer === '' && reasoning === '') {
      throw errors[0] ?? new BridgeTurnError('the free lane returned an empty answer', 502, 'EmptyResponse')
    }
    return { text: answer, reasoning, usage: usageOf(message) }
  } catch (error) {
    if (signal?.aborted === true) {
      void timedFetch(`${serverUrl}/session/${session}/abort`, { method: 'POST' }, 5000, undefined).catch(() => {})
    }
    throw error
  } finally {
    stopWatching()
    void timedFetch(`${serverUrl}/session/${session}`, { method: 'DELETE' }, 10000, undefined).catch(() => {})
  }
}
