/**
 * 免密免费模型（Zen free lane）编排
 *
 * 配置持久化、日志器
 * 注册`complete` / `modelRows` / `forwardKey` 
 * 
 * - 配置来自 `LLMConfig.freeProvider` 块（由 configs 持久化），运行时状态（探测结果 /
 *   catalog 缓存）落在 `app.getPath('userData')/llm-free` 下的 JsonStore。
 *
 * 进程提供本地 OpenAI 兼容转发代理（`/v1/chat/completions` + `/v1/responses`）
 * 下游工具 baseUrl 指向`http://127.0.0.1:<port>/v1` 使用。
 *
 * @module src/main/llm-free/service.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { FreeModelAdapter, ROUTE_MAIN, ROUTE_REGION } from './engine/adapter.js'
import { buildCatalog, parseListing } from './engine/catalog.js'
import { STATE, detectEgress, probeCatalog } from './engine/probe.js'
import { generateKey } from './engine/forward.js'
import { CODE, UpstreamError, getJson } from './engine/http.js'
import { mintRequestId, sessionForConversation, setUpstreamBase } from './engine/upstream.js'
import { toToolDefs } from './engine/messages.js'
import { JsonStore, resolveDataDir } from './store.js'
import { ForwardManager } from './forward-manager'
import type {
  CatalogEntry,
  FreeProviderConfig,
  FreeProviderStatus,
  FreeModelSummary,
  ProbeResult,
} from './type-info'
import { DEFAULT_FREE_PROVIDER_CONFIG } from './type-info'
import { getLlmConfig, saveLlmConfig } from '../configs/index'
import type { LLMConfig } from '../configs/type-info'
import { loggerFactory } from '../terminal-log'

const LOG_LABEL = 'LLM-FREE'
const log = loggerFactory(LOG_LABEL)

/** 冷启动无网络时仍展示的静态目录（与 DSH 的 FALLBACK_CATALOG 对齐）。 */
const FALLBACK_IDS = [
  'mimo-v2.6-flash-free', 'mimo-v2.5-free', 'ling-3.0-flash-fin-free',
  'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'space-bunny-free',
  'muse-spark-1.3-contributor-free', 'muse-spark-1.2-contributor-free',
]

/** 探测可用性快照（持久化在 availability.json）。 */
type AvailabilitySnapshot = {
  version: number
  at: number
  egress: { ip: string; country?: string } | null
  results: Record<string, { state: string; detail?: string; ttftMs?: number; latencyMs: number; at: number }>
}

/** 按可用性把目录切成「可用（主路由）/ 区域受限（副路由）」两组。 */
function computeMembership(
  catalog: Array<{ id: string }>,
  availabilitySnapshot: AvailabilitySnapshot,
  settings: FreeProviderConfig,
): Record<string, string[]> {
  const results = availabilitySnapshot?.results ?? {}
  const expose = settings?.exposeRegionModels !== false
  const verdictOf = (entry: { id: string }) => results[entry.id]?.state
  let usable = catalog.filter((entry) => verdictOf(entry) !== STATE.unavailable)
  if (catalog.length > 0 && usable.length === 0) usable = catalog
  const main: string[] = []
  const region: string[] = []
  for (const entry of usable) {
    const verdict = verdictOf(entry)
    if (verdict !== STATE.regionBlocked) main.push(entry.id)
    else if (expose) region.push(entry.id)
  }
  const membership: Record<string, string[]> = {}
  if (main.length > 0) membership[ROUTE_MAIN] = main
  if (region.length > 0) membership[ROUTE_REGION] = region
  return membership
}

function materializeCatalog(ids: string[]): Array<Record<string, unknown>> {
  const rebuilt = buildCatalog(ids)
  return rebuilt.length > 0 ? rebuilt : buildCatalog(FALLBACK_IDS)
}

/** OpenAI / Responses 请求消息 -> 引擎内部 harness 消息。 */
function fromOpenAiMessages(body: any, isResponses: boolean): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const rows = isResponses
    ? normaliseResponsesInput(body.input)
    : (Array.isArray(body.messages) ? body.messages : [])
  for (const row of rows) {
    const role = row.role ?? 'user'
    const content: Array<Record<string, unknown>> = []
    if (typeof row.content === 'string') {
      if (row.content !== '') content.push({ type: 'text', text: row.content })
    } else if (Array.isArray(row.content)) {
      for (const part of row.content) {
        if (typeof part === 'string') {
          if (part !== '') content.push({ type: 'text', text: part })
          continue
        }
        const text = part?.text ?? part?.input_text ?? part?.output_text
        if (typeof text === 'string' && text !== '') content.push({ type: 'text', text })
        const image = part?.image_url?.url ?? part?.image_url
        if (typeof image === 'string' && image !== '') {
          content.push({ type: 'image', attachment: { attachmentId: `url:${image.slice(0, 64)}`, mediaType: 'image/png', bytes: 0, width: 0, height: 0, url: image } })
        }
      }
    }
    if (role === 'tool') {
      out.push({
        role: 'tool',
        content: [{ type: 'text', text: typeof row.content === 'string' ? row.content : JSON.stringify(row.content ?? '') }],
        toolCallId: row.tool_call_id ?? '',
        source: { kind: 'tool', callId: row.tool_call_id ?? '' },
      })
      continue
    }
    if (role === 'assistant' && Array.isArray(row.tool_calls)) {
      for (const call of row.tool_calls) {
        content.push({ type: 'tool-call', id: call.id ?? '', name: call.function?.name ?? '', arguments: call.function?.arguments ?? '{}' })
      }
    }
    if (content.length === 0) continue
    out.push({
      role: role === 'developer' ? 'developer' : role === 'system' ? 'system' : role === 'assistant' ? 'assistant' : 'user',
      content,
      ...(role === 'assistant' ? { source: { kind: 'model' } } : {}),
    })
  }
  return out
}

function normaliseResponsesInput(input: unknown): Array<Record<string, unknown>> {
  if (typeof input === 'string') return [{ role: 'user', content: input }]
  if (!Array.isArray(input)) return []
  return input.map((row: any) => {
    if (typeof row === 'string') return { role: 'user', content: row }
    if (row.type === 'function_call') return { role: 'assistant', content: [], tool_calls: [{ id: row.call_id, function: { name: row.name, arguments: row.arguments } }] }
    if (row.type === 'function_call_output') return { role: 'tool', content: String(row.output ?? ''), tool_call_id: row.call_id }
    return row
  })
}

function normalizeTool(tool: any): { name: string; description: string; parameters: object } | null {
  const name = tool?.name ?? tool?.function?.name
  if (typeof name !== 'string' || name.trim() === '') return null
  const parameters = tool?.parameters ?? tool?.function?.parameters ?? { type: 'object', properties: {} }
  return { name, description: String(tool?.description ?? tool?.function?.description ?? ''), parameters }
}

function foldForwardOutcome(
  outcome: { text: string; toolCalls: any[]; usage?: unknown; truncated: boolean; error?: string },
  chunk: any,
): void {
  switch (chunk.type) {
    case 'text-delta':
      outcome.text += chunk.text
      break
    case 'tool-call-delta': {
      let call = outcome.toolCalls.find((candidate) => candidate.slot === chunk.index)
      if (call === undefined) { call = { slot: chunk.index, id: chunk.id ?? '', name: chunk.name ?? '', arguments: chunk.argumentsDelta ?? '' }; outcome.toolCalls.push(call) }
      else call.arguments += chunk.argumentsDelta ?? ''
      if (chunk.name) call.name = chunk.name
      if (chunk.id) call.id = chunk.id
      break
    }
    case 'block-end':
      if (chunk.block?.type === 'tool-call') {
        const existing = outcome.toolCalls.find((candidate) => candidate.id === chunk.block.id)
        if (existing === undefined) outcome.toolCalls.push({ slot: chunk.index, id: chunk.block.id, name: chunk.block.name, arguments: chunk.block.arguments })
      }
      break
    case 'usage':
      outcome.usage = chunk.usage
      break
    case 'finish':
      if (chunk.reason?.kind === 'max-tokens') outcome.truncated = true
      if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') outcome.error = chunk.reason.failure?.message
      break
    default:
      break
  }
}

/** 只允许转发代理绑定回环地址，避免把本机免费额度开给整个子网（实现见 forward-manager.ts）。 */

// ── 编排类 ───────────────────────────────────────────────────────────────────

class LlmFreeService {
  private catalog: Array<Record<string, unknown>> = []
  private egress: { ip: string; country?: string } | null = null
  private disposed = false
  private attributionUserAgent = 'deepseek-harness'

  /** 转发代理运行时状态机（纯逻辑，见 forward-manager.ts）。 */
  private forwardManager: ForwardManager

  private config: FreeProviderConfig
  private availability: JsonStore
  private catalogStore: JsonStore
  private adapter: FreeModelAdapter

  private probeRound: Promise<unknown> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private reprobeTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    const dataDir = resolveDataDir(app.getPath('userData'))
    fs.mkdirSync(dataDir, { recursive: true })

    this.config = this.loadConfig()
    setUpstreamBase(this.config.upstream)

    this.availability = new JsonStore(path.join(dataDir, 'availability.json'), {
      version: 1, at: 0, egress: null, results: {},
    } as any)
    this.catalogStore = new JsonStore(path.join(dataDir, 'catalog.json'), {
      version: 1, at: 0, entries: [...FALLBACK_IDS],
    } as any)

    this.catalog = materializeCatalog((this.catalogStore.get() as any).entries ?? [])
    this.egress = (this.availability.get() as any).egress ?? null

    this.adapter = new FreeModelAdapter({
      state: () => this.state(),
      resolveImage: undefined,
      recordUsage: () => {},
      recordTurn: () => {},
      warn: (message: string) => log.warn(message),
      onRegionBlocked: () => this.scheduleReprobe(),
    })

    this.forwardManager = new ForwardManager({
      complete: (request, onChunk) => this.runForwarded(request, onChunk),
      modelRows: () => this.publicModelRows(),
      forwardKey: () => this.forwardKey(),
      log: (message) => log.warn(message),
    })
  }

  // ── 配置读写 ──────────────────────────────────────────────────────────────

  private loadConfig(): FreeProviderConfig {
    const stored = (getLlmConfig() as LLMConfig & { freeProvider?: FreeProviderConfig }).freeProvider
    return { ...DEFAULT_FREE_PROVIDER_CONFIG, ...(stored ?? {}) }
  }

  private persistConfig(): void {
    const full = getLlmConfig() as LLMConfig & { freeProvider?: FreeProviderConfig }
    full.freeProvider = this.config
    saveLlmConfig(full as LLMConfig)
  }

  private mergeConfig(base: FreeProviderConfig, patch: Partial<FreeProviderConfig>): FreeProviderConfig {
    const next: FreeProviderConfig = { ...base, ...patch }
    if (patch.forward) next.forward = { ...base.forward, ...patch.forward }
    return next
  }

  // ── 不可变快照 ─────────────────────────────────────────────────────────────

  private state() {
    return {
      catalog: this.catalog,
      membership: computeMembership(this.catalog as any, this.availability.get() as any, this.config),
      settings: this.config,
      attributionUserAgent: this.attributionUserAgent,
    }
  }

  // ── catalog + 可用性 ───────────────────────────────────────────────────────

  private async fetchListing(): Promise<any> {
    return getJson('/zen/v1/models', {
      session: sessionForConversation('catalog:our-free-model'),
      requestId: mintRequestId(),
      attributionUserAgent: this.attributionUserAgent,
    })
  }

  async refreshCatalog({ probe = true }: { probe?: boolean } = {}): Promise<Array<Record<string, unknown>>> {
    let ids: string[] = []
    try {
      ids = parseListing(await this.fetchListing())
    } catch (error) {
      log.warn(`model listing refresh failed (${(error as Error)?.message ?? error}); keeping cached catalog`)
    }
    if (ids.length > 0) {
      this.catalog = buildCatalog(ids)
      this.catalogStore.update({ at: Date.now(), entries: this.catalog.map((e) => e.id) } as any)
      this.catalogStore.flush()
      this.config = { ...this.config, catalogSyncedAt: Date.now() }
      this.persistConfig()
    } else {
      this.catalog = materializeCatalog((this.catalogStore.get() as any).entries ?? [])
    }
    if (probe) await this.refreshAvailability()
    return this.catalog
  }

  private async runProbeRound(): Promise<Record<string, ProbeResult>> {
    // 并发保持为 1：本通道按会话计配额，突发会触发 429，导致大量模型被误判为 unknown。
    const results = await probeCatalog(
      this.catalog as any,
      { attributionUserAgent: this.attributionUserAgent },
      (id: string, result: any) => {
        this.availability.edit((state: any) => ({
          ...state,
          results: {
            ...state.results,
            [id]: {
              state: result.state,
              ...(result.detail === undefined ? {} : { detail: result.detail }),
              ...(result.ttftMs === undefined ? {} : { ttftMs: result.ttftMs }),
              latencyMs: result.latencyMs,
              at: Date.now(),
            },
          },
        }))
      },
      1,
    )
    this.availability.update({ at: Date.now(), egress: this.egress } as any)
    this.availability.flush()
    const verdicts = Object.values(results) as ProbeResult[]
    if (verdicts.length > 0 && verdicts.every((row) => row.state === STATE.unavailable)) {
      log.warn(`gateway refused all ${verdicts.length} models this round (${verdicts[0].detail ?? 'no detail'}); keeping them advertised`)
    }
    return results
  }

  async refreshAvailability(): Promise<unknown> {
    if (this.probeRound !== null) return this.probeRound
    const round = this.runProbeRound()
    this.probeRound = round
    try {
      return await round
    } finally {
      if (this.probeRound === round) this.probeRound = null
    }
  }

  private async watchEgress(): Promise<void> {
    const seen = await detectEgress()
    if (seen === undefined) return
    const previous = (this.availability.get() as any).egress
    const changed = previous == null
      || previous.ip !== seen.ip
      || (seen.country !== undefined && previous.country !== seen.country)
    this.egress = seen as any
    if (changed) {
      this.availability.update({ egress: seen } as any)
      this.availability.flush()
      log.log(`egress changed to ${seen.ip}${seen.country ? ` (${seen.country})` : ''}; re-probing availability`)
      await this.refreshAvailability()
    }
  }

  private scheduleReprobe(): void {
    if (this.reprobeTimer !== undefined) return
    this.reprobeTimer = setTimeout(() => {
      this.reprobeTimer = undefined
      void this.refreshAvailability().catch(() => {})
    }, 4000)
    this.reprobeTimer.unref?.()
  }

  // ── 转发代理 ───────────────────────────────────────────────────────────────

  private forwardKey(): string {
    const current = this.config.forward
    if (typeof current.key === 'string' && current.key !== '') return current.key
    const minted = generateKey()
    this.config = { ...this.config, forward: { ...current, key: minted } }
    this.persistConfig()
    return minted
  }

  /** 委托给 forwardManager  */
  private async syncForward(): Promise<void> {
    const bound = await this.forwardManager.syncForward({
      enabled: this.config.enabled === true,
      host: this.config.forward?.host,
      port: this.config.forward?.port,
    })
    if (bound && bound.running && bound.host !== undefined && bound.port !== undefined) {
      this.config = { ...this.config, forward: { ...this.config.forward, port: bound.port, host: bound.host } }
      this.persistConfig()
    }
  }

  /** 跑一次转发请求：OpenAI 体 -> harness，累积 outcome 供非流式分支使用。 */
  async runForwarded(request: any, onChunk?: (chunk: any) => void): Promise<any> {
    const entry = this.catalog.find((candidate) => candidate.id === request.model)
    if (entry === undefined) throw new UpstreamError(`unknown model "${request.model}"`, CODE.server)
    const openAi = request.openAi ?? {}
    const messages = fromOpenAiMessages(openAi, request.responses === true)
    const tools = toToolDefs((openAi.tools ?? []).map(normalizeTool).filter(Boolean), request.responses === true ? 'flat' : 'chat')
    const handler = typeof onChunk === 'function' ? onChunk : () => {}
    const outcome = { text: '', toolCalls: [], usage: undefined, truncated: false, error: undefined }

    const options: any = {
      provider: ROUTE_MAIN,
      model: entry.id,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      ...(typeof openAi.temperature === 'number' ? { temperature: openAi.temperature } : {}),
      ...(typeof openAi.max_tokens === 'number' ? { maxTokens: openAi.max_tokens } : {}),
      ...(typeof openAi.reasoning_effort === 'string' ? { reasoningEffort: openAi.reasoning_effort } : {}),
      sessionId: `forward:${String(openAi.user ?? openAi.conversation ?? 'shared')}`,
      signal: request.signal,
    }

    for await (const chunk of this.adapter.stream(options, entry, this.state() as any)) {
      handler(chunk)
      foldForwardOutcome(outcome, chunk)
    }
    if (outcome.truncated === true) {
      outcome.toolCalls = outcome.toolCalls.filter((call: any) => {
        try { JSON.parse(call.arguments === '' ? '{}' : call.arguments); return true } catch { return false }
      })
    }
    return outcome
  }

  /**
   * 转发代理 GET /v1/models 暴露的行。
   *
   * 只有 `id` 是承重字段：`created` / `owned_by` 是 OpenAI 列表格式要求补齐的占位值，
   * 本通道不承诺它们有语义。下游工具只按 id 取模型。
   */
  private publicModelRows(): Array<{ id: string; object: string; created: number; owned_by: string; context_window?: number }> {
    const membership = new Set(this.state().membership[ROUTE_MAIN] ?? [])
    if (this.config.exposeRegionModels !== false) {
      for (const id of this.state().membership[ROUTE_REGION] ?? []) membership.add(id)
    }
    const whitelist = this.config.modelWhitelist
    return this.catalog
      .filter((entry) => {
        if (!membership.has(entry.id as string)) return false
        if (Array.isArray(whitelist) && whitelist.length > 0) return whitelist.includes(entry.id as string)
        return true
      })
      .map((entry) => ({
        id: entry.id as string,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'our-free-model',
        ...(entry.contextWindow === undefined ? {} : { context_window: entry.contextWindow as number }),
      }))
  }

  // ── 生命周期 ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.disposed) return
    setUpstreamBase(this.config.upstream)
    await this.syncForward()
    await this.refreshCatalog({ probe: true })
    await this.watchEgress().catch(() => {})
    this.scheduleRefresh()
  }

  async stop(): Promise<void> {
    if (this.refreshTimer !== null) { clearInterval(this.refreshTimer); this.refreshTimer = null }
    if (this.reprobeTimer !== undefined) { clearTimeout(this.reprobeTimer); this.reprobeTimer = undefined }
    await this.forwardManager.stop()
  }

  dispose(): void {
    this.disposed = true
    void this.stop()
    this.availability.dispose()
    this.catalogStore.dispose()
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return
    this.refreshTimer = setInterval(() => {
      void this.refreshCatalog({ probe: true }).catch(() => {})
      void this.watchEgress().catch(() => {})
    }, 5 * 60 * 1000)
    this.refreshTimer.unref?.()
  }

  // ── IPC 业务入口 ───────────────────────────────────────────────────────────

  getConfig(): FreeProviderConfig {
    return { ...this.config, forward: { ...this.config.forward } }
  }

  setConfig(patch: Partial<FreeProviderConfig>): FreeProviderConfig {
    const prevEnabled = this.config.enabled
    this.config = this.mergeConfig(this.config, patch)
    setUpstreamBase(this.config.upstream)
    this.persistConfig()
    void this.syncForward()
    if (this.config.enabled && !prevEnabled) void this.start()
    return this.getConfig()
  }

  async regenerateKey(): Promise<string> {
    const minted = generateKey()
    this.config = { ...this.config, forward: { ...this.config.forward, key: minted } }
    this.persistConfig()
    await this.syncForward()
    return minted
  }

  async probe(): Promise<Record<string, unknown>> {
    await this.refreshAvailability()
    return (this.availability.get() as any).results
  }

  async refreshCatalogNow(): Promise<{ entries: Array<Record<string, unknown>>; membership: Record<string, string[]> }> {
    const catalog = await this.refreshCatalog({ probe: true })
    return { entries: catalog, membership: this.state().membership }
  }

  getModels(): Array<Record<string, unknown>> {
    return this.publicModelRows()
  }

  getStatus(): FreeProviderStatus {
    const config = this.config
    const forward = this.forwardManager.getStatusFragment()
    const availability = this.availability.get() as any
    const membership = this.state().membership
    const usable = new Set(membership[ROUTE_MAIN] ?? [])
    const region = new Set(membership[ROUTE_REGION] ?? [])
    const whitelist = config.modelWhitelist
    const models: FreeModelSummary[] = this.catalog
      .filter((entry) => {
        const id = entry.id as string
        if (!usable.has(id) && !(config.exposeRegionModels !== false && region.has(id))) return false
        if (Array.isArray(whitelist) && whitelist.length > 0) return whitelist.includes(id)
        return true
      })
      .map((entry) => {
        const id = entry.id as string
        const verdict = availability.results?.[id]?.state ?? 'unknown'
        return {
          id,
          name: entry.name as string,
          state: verdict,
          vision: entry.vision === true,
          reasoning: entry.reasoning !== false,
          contextWindow: (entry.contextWindow as number) ?? 131072,
          maxOutput: (entry.maxOutput as number) ?? 32768,
        }
      })
    return {
      enabled: config.enabled,
      running: forward.running,
      port: forward.port ?? config.forward.port,
      key: config.forward.key,
      egress: this.egress,
      models,
      catalogSyncedAt: config.catalogSyncedAt ?? 0,
      ...(forward.error ? { error: forward.error } : {}),
    }
  }
}

/** `toToolDefs` 已在文件顶部静态导入（引擎在 commonjs 下按原样 ESM 拷入 webpack 即可解析）。 */

let singleton: LlmFreeService | null = null

/** 懒构造单例：首次使用时才解析 userData 目录。 */
export function getLlmFreeService(): LlmFreeService {
  if (singleton === null) singleton = new LlmFreeService()
  return singleton
}

export { LlmFreeService }
