/**
 * dsh 模型 / 密钥同步的纯计算部分：把本项目的大模型配置换算成要写进
 * `$DSH_HOME/settings.yaml` 与 `$DSH_HOME/.credentials.yaml` 的内容。
 *
 * 配置形态参考官方文档（「添加内置提供方」一节）：
 * https://deepseek-harness.github.io/deepseek-harness/guide/providers#添加内置提供方
 * - DeepSeek 官方提供方：走内置路由 `deepseek-official`（由插件 `dsh-llm-deepseek` 注册），
 *   只写 `llm-deepseek` 分节的 `apiKeyEnv` / `baseURL`，模型目录由 dsh 自带
 * - 其它提供方（公司网关、自建服务、OpenAI 兼容端点）：走 `dsh-llm-pi-ai` 的自定义提供方，
 *   每条路由写 `api` / `baseURL` / `models`，有密钥时再写 `apiKeyEnv`
 *
 * 本文件刻意不 import electron / fs / yaml：只做计算，方便单独跑校验脚本；
 * 文件读写留在 index.ts 里。
 */

/** 参与同步的模型字段（CustomModel 的结构子集） */
export interface SyncableModel {
  id?: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey?: string;
  displayName?: string;
  /** 嵌入模型不参与 LLM 路由同步 */
  isEmbeddingModel?: boolean;
}

/** settings.yaml 里 llm-pi-ai.providers.<route> 的值 */
export interface PiAiProviderConfig {
  api: 'openai-completions';
  baseURL: string;
  /**
   * 凭据引用：只有配置了非空 API key 的模型才会生成路由，所以这里一定会有值。
   * 写下一个解析不到值的引用会让 dsh 的每次请求都以 MISSING_CREDENTIAL 失败
   * （见 https://deepseek-harness.github.io/deepseek-harness/guide/providers 的排错一节）。
   */
  apiKeyEnv: string;
  models: Array<{ id: string; name: string }>;
}

/** settings.yaml 里 llm-deepseek 分节（DeepSeek 内置提供方 deepseek-official 的连接事实） */
export interface DeepseekSection {
  apiKeyEnv: string;
  baseURL: string;
}

export interface ModelSyncPlan {
  /** 要写进 .credentials.yaml 的 refs：只包含非空（去空白后仍有内容）的密钥 */
  credentials: Record<string, string>;
  /** 要合并进 settings.yaml 的 llm-pi-ai.providers */
  piAiProviders: Record<string, PiAiProviderConfig>;
  /** 要合并进 settings.yaml 的 llm-deepseek；没有任何带密钥的 DeepSeek 模型时为 null */
  deepseek: DeepseekSection | null;
  /** 建议写入 settings.yaml 的 agent-default-model（仅在 dsh 里还没有默认模型时使用） */
  defaultModel: { provider: string; model: string } | null;
  /** 因为密钥为空 / 全空白而整条跳过的模型名（不写路由也不写凭据，用于日志提示） */
  keylessModels: string[];
  /** 配置互相冲突、被忽略掉的信息（用于日志提示） */
  warnings: string[];
}

/** `dsh-llm-deepseek` 独占的内置路由名 */
export const DEEPSEEK_OFFICIAL_ROUTE = 'deepseek-official';

/**
 * DeepSeek 内置路由的凭据引用名。
 * 用本项目自己的命名空间（DSH_ 前缀）而不是 dsh 默认的 `DEEPSEEK_API_KEY`，
 * 这样不会覆盖用户在 dsh 模型页里给 DeepSeek 卡片单独保存的那把 key。
 */
export const DEEPSEEK_API_KEY_REF = 'DSH_DEEPSEEK_API_KEY';

/**
 * 取真正可用的密钥：去掉首尾空白后为空（空字符串、全空白、undefined）都算「没配密钥」。
 * 密钥里的首尾空白一定是用户误输入（复制粘贴带上的换行/空格），顺手去掉。
 */
export function normalizeApiKey(apiKey?: string): string {
  return (apiKey ?? '').trim();
}

/** 是否本项目配置里的 DeepSeek 官方提供方 */
export function isDeepseekProvider(model: SyncableModel): boolean {
  return (model.provider ?? '').trim().toLowerCase() === 'deepseek';
}

/** 把模型名/id 规范成可用的标识：小写、非法字符替换为 `-` */
export function slugify(name: string): string {
  const slug = (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'model';
}

/** 模型对应的 dsh 路由名（也是凭据引用名的前缀） */
export function routeKeyOf(model: SyncableModel): string {
  return slugify(model.id || model.name);
}

/** 模型对应的 dsh 凭据引用名（写入 .credentials.yaml 的 refs 里） */
export function apiKeyRefOf(model: SyncableModel): string {
  return `DSH_${routeKeyOf(model).replace(/-/g, '_').toUpperCase()}_API_KEY`;
}

/** plan 里是否有任何要写进 settings.yaml 的内容（没有就完全不动用户的文件） */
export function hasSettingsToSync(plan: ModelSyncPlan): boolean {
  return Object.keys(plan.piAiProviders).length > 0 || plan.deepseek !== null;
}

/** {@link mergeModelSyncIntoSettings} 的结果 */
export interface SettingsMergeResult {
  /** 分节名 → 合并后的完整分节值（dsh 的 provider 是整节替换，所以必须带上已有内容） */
  sections: Record<string, unknown>;
  /** 给日志用的写入摘要 */
  summary: string[];
}

/**
 * 把同步计划合并进一份 settings 文档：
 * - `llm-pi-ai.providers`：保留 dsh 里已有的路由，只增改本项目模型对应的路由
 * - `llm-deepseek`：保留已有字段（reasoningEffort 等），只改连接事实
 * - `agent-default-model`：只有文档里还没有时才设置，且只挑「有密钥」的模型
 *
 * 写文件和写内存文档的两条路径（dsh 自带配置包 / 内置文本写入）共用这里，
 * 保证两条路径写出的内容与日志完全一致。
 */
export function mergeModelSyncIntoSettings(
  document: Record<string, unknown>,
  plan: ModelSyncPlan,
): SettingsMergeResult {
  const sections: Record<string, unknown> = {};
  const summary: string[] = [];

  const routeKeys = Object.keys(plan.piAiProviders);
  if (routeKeys.length > 0) {
    const existing = document['llm-pi-ai'] as
      | { providers?: Record<string, unknown> }
      | undefined;
    sections['llm-pi-ai'] = {
      ...existing,
      providers: { ...(existing?.providers ?? {}), ...plan.piAiProviders },
    };
    summary.push(
      `${routeKeys.length} 条 llm-pi-ai 路由（${routeKeys.join('、')}）`,
    );
  }

  // DeepSeek 内置提供方：只改连接事实，不声明 models（模型目录沿用 dsh 自带的）
  if (plan.deepseek) {
    const existing = document['llm-deepseek'] as
      | Record<string, unknown>
      | undefined;
    sections['llm-deepseek'] = { ...(existing ?? {}), ...plan.deepseek };
    summary.push(`内置 ${DEEPSEEK_OFFICIAL_ROUTE} 路由（llm-deepseek 分节）`);
  }

  if (!document['agent-default-model'] && plan.defaultModel) {
    sections['agent-default-model'] = plan.defaultModel;
    summary.push(
      `默认模型 ${plan.defaultModel.provider}/${plan.defaultModel.model}`,
    );
  }

  return { sections, summary };
}

/**
 * 把本项目配置的模型换算成 dsh 侧要写入的内容。
 *
 * 规则：
 * - **密钥为空 / 全空白：这个模型完全不写进 dsh** —— 不写凭据，也不生成路由
 *   （「不要把 token 配置到 dsh 里」，同时也不留一条注定认证失败的路由），
 *   模型名记进 {@link ModelSyncPlan.keylessModels} 由调用方提示用户
 * - 密钥非空：写凭据（值是去掉首尾空白的密钥），并生成带 `apiKeyEnv` 的路由
 * - DeepSeek 提供方的模型：写进 `llm-deepseek`（内置路由 `deepseek-official`），
 *   模型目录用 dsh 自带的，不在这里声明 `models`
 * - 其它提供方：每条模型一条 `llm-pi-ai` 路由
 * - `agent-default-model` 只从「有密钥」的模型里挑第一条，避免默认模型一开机就缺凭据
 */
export function planDshModelSync(models: SyncableModel[]): ModelSyncPlan {
  const credentials: Record<string, string> = {};
  const piAiProviders: Record<string, PiAiProviderConfig> = {};
  const keylessModels: string[] = [];
  const warnings: string[] = [];
  let deepseek: DeepseekSection | null = null;
  let defaultModel: ModelSyncPlan['defaultModel'] = null;

  for (const model of models) {
    const apiKey = normalizeApiKey(model.apiKey);
    if (!apiKey) {
      // 没有可用密钥的模型整条跳过（本地模型也一样：pi-ai 的 openai-completions 路由
      // 没有密钥/Authorization 头时请求必然失败，写进去只会污染 dsh 的模型选择器）
      keylessModels.push(model.name);
      continue;
    }

    if (isDeepseekProvider(model)) {
      // DeepSeek 内置提供方是「一个路由 + 一份连接事实」：多个 DeepSeek 模型共用
      // llm-deepseek 分节，端点取第一条带密钥的模型配置
      if (!deepseek) {
        deepseek = { apiKeyEnv: DEEPSEEK_API_KEY_REF, baseURL: model.baseUrl };
      } else if (deepseek.baseURL !== model.baseUrl) {
        warnings.push(
          `DeepSeek 提供方共用一个内置路由（${DEEPSEEK_OFFICIAL_ROUTE}），模型 ${model.name} 的 API 地址 ${model.baseUrl} 与已采用的 ${deepseek.baseURL} 不一致，已按后者写入`,
        );
      }
      credentials[DEEPSEEK_API_KEY_REF] = apiKey;
      if (!defaultModel) {
        defaultModel = { provider: DEEPSEEK_OFFICIAL_ROUTE, model: model.name };
      }
      continue;
    }

    const route = routeKeyOf(model);
    const apiKeyEnv = apiKeyRefOf(model);
    piAiProviders[route] = {
      api: 'openai-completions',
      baseURL: model.baseUrl,
      apiKeyEnv,
      models: [
        {
          id: model.name,
          name: model.displayName || model.name,
        },
      ],
    };
    credentials[apiKeyEnv] = apiKey;

    if (!defaultModel) {
      defaultModel = { provider: route, model: model.name };
    }
  }

  return {
    credentials,
    piAiProviders,
    deepseek,
    defaultModel,
    keylessModels,
    warnings,
  };
}
