/**
 * 免密免费模型（Zen free lane）IPC 频道名与类型定义。
 *
 * 启动器只做「配置管理 + 本地 OpenAI 兼容转发代理」，真正的模型调用发生在别处
 * （dsh / Obsidian / LM Studio / 下游工具）。下游工具把 `baseUrl` 指向
 * `http://127.0.0.1:<port>/v1` 即可使用本代理。
 */

export const channel = 'llm-free'

/** 读取当前配置（FreeProviderConfig） */
export const llmFreeQueryConfigHandle = `${channel}/query-config`
/** 保存配置补丁（Partial<FreeProviderConfig>） */
export const llmFreeSetConfigHandle = `${channel}/set-config`
/** 启动转发代理 + 初始 catalog/probe */
export const llmFreeStartHandle = `${channel}/start`
/** 停止转发代理 */
export const llmFreeStopHandle = `${channel}/stop`
/** 查询运行状态（FreeProviderStatus，含状态点所需信息） */
export const llmFreeStatusHandle = `${channel}/status`
/** 重新生成转发代理密钥，返回新 key */
export const llmFreeRegenerateKeyHandle = `${channel}/regenerate-key`
/** 立即跑一次可用性探测 */
export const llmFreeProbeHandle = `${channel}/probe`
/** 刷新模型目录（实时 Zen 合并）+ 探测 */
export const llmFreeCatalogHandle = `${channel}/catalog`
/** 返回转发代理对外暴露的模型列表（供白名单编辑器使用） */
export const llmFreeModelsHandle = `${channel}/models`

export type EffortLevel = 'light' | 'balanced' | 'deep'
export type FingerprintMode = 'auto' | 'minimal'

/** 免密免费模型配置块（独立存储，不污染已有的 LLMConfig） */
export interface FreeProviderConfig {
  /** 总开关：开启即拉起本地转发代理 */
  enabled: boolean
  /** 网关基地址，默认 https://opencode.ai（可用镜像覆盖） */
  upstream: string
  /** 默认推理力度预设 */
  defaultEffort: EffortLevel
  /** 指纹模式：auto = 完整四人组（含兜底 decoy）；minimal = 仅填已声明名 */
  fingerprintMode: FingerprintMode
  /** 单回合输出上限（token） */
  defaultMaxTokens: number
  /** 是否在模型列表中展示区域性受限模型 */
  exposeRegionModels: boolean
  /** 是否允许一次纯推理检查点续写 */
  streamRecovery: boolean
  /** 模型白名单：为空表示放行所有可用模型 */
  modelWhitelist: string[]
  /** 本地转发代理 */
  forward: {
    host: string
    port: number
    /** 已签发的访问密钥（空则首次启动时生成并持久化） */
    key: string
  }
}

/** 单个模型在目录中的摘要（状态点/白名单编辑器用） */
export interface FreeModelSummary {
  id: string
  name: string
  /** 路由状态：usable / region-blocked / unknown / unavailable */
  state: string
  /** 是否vision模型 */
  vision: boolean
  /** 是否reasoning模型 */
  reasoning: boolean
  contextWindow: number
  maxOutput: number
}

/** 状态点/概览信息 */
export interface FreeProviderStatus {
  enabled: boolean
  /** 转发代理是否在运行 */
  running: boolean
  port: number
  /** 转发代理密钥（仅状态展示用，真实鉴权在代理侧） */
  key: string
  /** 出口公网地址信息（探测得到） */
  egress: { ip: string; country?: string } | null
  /** 模型目录（已按白名单/可用性过滤，供转发与展示） */
  models: FreeModelSummary[]
  /** 上次 catalog 合并时间戳 */
  catalogSyncedAt: number
  /** 最近一次错误（若有） */
  error?: string
}

export const DEFAULT_FREE_PROVIDER_CONFIG: FreeProviderConfig = {
  enabled: false,
  upstream: 'https://opencode.ai',
  defaultEffort: 'balanced',
  fingerprintMode: 'auto',
  defaultMaxTokens: 32768,
  exposeRegionModels: true,
  streamRecovery: true,
  modelWhitelist: [],
  forward: {
    host: '127.0.0.1',
    port: 18765,
    key: '',
  },
}
