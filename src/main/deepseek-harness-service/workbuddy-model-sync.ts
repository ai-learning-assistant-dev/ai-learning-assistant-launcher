/**
 * 把 **WorkBuddy 的自定义模型配置**（`%USERPROFILE%\.workbuddy\models.json`）
 * 换算成要写进 dsh 的内容。
 *
 * 与 `model-sync-plan.ts`（换算「本项目自己的大模型配置」）的区别：
 * - 那边是「一个模型一条 llm-pi-ai 路由」，因为本项目配置里每个模型都是独立端点；
 * - 这边是「一个 vendor 一条路由 + 一条路由下挂多个模型」，因为 WorkBuddy 的
 *   `vendor` 天然就是同一个网关的多个模型别名，拆成十几条路由反而没法用；
 * - 这边额外带上 `contextWindow` / `maxTokens` / `input`：WorkBuddy 的
 *   `maxInputTokens` / `maxOutputTokens` / `supportsImages` 正好对应 dsh 的这三个字段。
 *
 * WorkBuddy 的模型一律走 `llm-pi-ai` 自定义提供方路由，**不**特殊处理 DeepSeek：
 * WorkBuddy 里的模型名是它自己的别名（例如 `极速` 映射到网关的 `Buddy-Fast`），
 * 塞进 dsh 内置的 `deepseek-official` 路由只会对不上它自带的模型目录。
 *
 * 本文件只做「读文件 + 纯计算」；写文件与备份在 dsh-model-sync.ts 里。
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import {
  apiKeyRefOfRoute,
  normalizeApiKey,
  slugify,
  type ModelSyncPlan,
  type PiAiModelEntry,
  type PiAiProviderConfig,
} from './model-sync-plan';

/** WorkBuddy 自定义模型配置里本模块用到的字段 */
export interface WorkbuddyModel {
  /** 模型 id：WorkBuddy 里也可能是中文别名，直接原样发给网关 */
  id?: string;
  /** WorkBuddy 的供应商名（同一个网关的多个模型共用），用作 dsh 的提供方显示名 */
  name?: string;
  /** 网关标识（如 apiget），用作 dsh 的路由名 */
  vendor?: string;
  /** OpenAI 兼容端点，通常形如 `https://host/v1/chat/completions` */
  url?: string;
  apiKey?: string;
  /** 计费倍率，形如 `x0.07`；只用来拼模型显示名 */
  credits?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsImages?: boolean;
}

/** WorkBuddy 模型配置的路径（`%USERPROFILE%\.workbuddy\models.json`） */
export function resolveWorkbuddyModelsPath(): string {
  return path.join(homedir(), '.workbuddy', 'models.json');
}

/** 换算过程中丢弃 / 跳过的模型，用于日志与界面提示 */
export interface WorkbuddySyncNotice {
  /** 模型名 */
  name: string;
  /** 为什么没进 dsh */
  reason: string;
}

export interface WorkbuddyModelSyncPlan {
  /** 直接可以交给 applyModelSyncViaDshPackages 的计划 */
  plan: ModelSyncPlan;
  /** 参与换算的模型总数（原始条数） */
  total: number;
  /** 最终写进 dsh 的模型数 */
  synced: number;
  /** 丢弃 / 跳过的模型 */
  notices: WorkbuddySyncNotice[];
}

/** 从 WorkBuddy 的 url 反推 OpenAI 兼容 baseURL（去掉 `/chat/completions` 之类后缀） */
export function baseUrlOfWorkbuddyModel(url?: string): string | null {
  const raw = (url ?? '').trim();
  if (!raw) {
    return null;
  }
  return (
    raw
      .replace(/\/+$/, '')
      .replace(/\/(chat\/)?completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/+$/, '') || null
  );
}

/** 模型所属的 dsh 路由名：优先用 WorkBuddy 的 vendor，缺省时退回端点主机名 */
export function routeOfWorkbuddyModel(
  model: WorkbuddyModel,
  baseURL: string,
): string {
  const fromVendor = slugify(model.vendor ?? '');
  if (fromVendor) {
    return fromVendor;
  }
  try {
    return slugify(new URL(baseURL).hostname);
  } catch {
    return 'workbuddy';
  }
}

/** 读 WorkBuddy 的模型配置；文件缺失 / 格式不对时抛出可直接展示给用户的错误 */
export function readWorkbuddyModels(
  modelsPath: string = resolveWorkbuddyModelsPath(),
): WorkbuddyModel[] {
  let raw: string;
  try {
    raw = readFileSync(modelsPath, 'utf8');
  } catch {
    throw new Error(
      `没有找到 WorkBuddy 的模型配置：${modelsPath}。请先在 WorkBuddy 里配置好自定义模型再同步`,
    );
  }

  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch (error) {
    throw new Error(
      `WorkBuddy 的模型配置不是合法的 JSON/YAML（${modelsPath}）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `WorkBuddy 的模型配置格式不符合预期（${modelsPath}）：顶层应当是一个模型数组`,
    );
  }
  return parsed as WorkbuddyModel[];
}

/**
 * 把 WorkBuddy 的模型列表换算成 dsh 侧的写入计划。
 *
 * 规则：
 * - **没有可用 API key 的模型整条跳过**（与本项目自己的同步保持一致：
 *   pi-ai 的 `openai-completions` 路由没有密钥时请求必然失败，写进去只会污染选择器）
 * - 按 `vendor + baseURL + apiKey` 分组，同一组共用一条 `llm-pi-ai` 路由，
 *   多个模型挂在同一条路由的 `models` 下
 * - 路由名取 `vendor` 的 slug；同一个 vendor 出现多条路由时依次加 `-2`、`-3` 后缀
 * - `maxInputTokens` → `contextWindow`，`maxOutputTokens` → `maxTokens`（明确对应）
 * - `supportsImages === true` → `input: [text, image]`
 * - 模型显示名沿用 WorkBuddy 的计费倍率标注，形如 `DeepSeek-V4.1-Flash (x0.07)`
 */
export function planWorkbuddyModelSync(
  models: WorkbuddyModel[],
): WorkbuddyModelSyncPlan {
  const notices: WorkbuddySyncNotice[] = [];
  const credentials: Record<string, string> = {};
  const piAiProviders: Record<string, PiAiProviderConfig> = {};
  const warnings: string[] = [];

  interface Group {
    route: string;
    baseURL: string;
    apiKey: string;
    displayNames: string[];
    models: PiAiModelEntry[];
    ids: Set<string>;
  }
  const groups = new Map<string, Group>();

  for (const model of models) {
    const label =
      (model?.id ?? '').trim() || (model?.name ?? '').trim() || '(未命名模型)';

    const id = (model?.id ?? '').trim();
    if (!id) {
      notices.push({ name: label, reason: '缺少模型 id' });
      continue;
    }

    const apiKey = normalizeApiKey(model.apiKey);
    if (!apiKey) {
      notices.push({ name: id, reason: 'API key 为空，已整条跳过' });
      continue;
    }

    const baseURL = baseUrlOfWorkbuddyModel(model.url);
    if (!baseURL) {
      notices.push({ name: id, reason: '缺少可用的 API 地址（url）' });
      continue;
    }

    const route = routeOfWorkbuddyModel(model, baseURL);
    const groupKey = `${route}\u0000${baseURL}\u0000${apiKey}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        route,
        baseURL,
        apiKey,
        displayNames: [],
        models: [],
        ids: new Set<string>(),
      };
      groups.set(groupKey, group);
    }

    if (group.ids.has(id)) {
      notices.push({
        name: id,
        reason: '同一提供方下重复的模型 id，只保留先出现的',
      });
      continue;
    }
    group.ids.add(id);

    if ((model.name ?? '').trim()) {
      group.displayNames.push((model.name ?? '').trim());
    }

    const credits = (model.credits ?? '').trim();
    const entry: PiAiModelEntry = {
      id,
      name: credits ? `${id} (${credits})` : id,
    };
    if (Number.isFinite(model.maxInputTokens)) {
      entry.contextWindow = model.maxInputTokens;
    }
    if (Number.isFinite(model.maxOutputTokens)) {
      entry.maxTokens = model.maxOutputTokens;
    }
    if (model.supportsImages === true) {
      entry.input = ['text', 'image'];
    }
    group.models.push(entry);
  }

  // 同一个 vendor 分出多条路由时加后缀，避免后写的路由覆盖前面的
  const usedRoutes = new Set<string>();
  let defaultModel: ModelSyncPlan['defaultModel'] = null;
  let synced = 0;

  for (const group of groups.values()) {
    let route = group.route;
    for (let n = 2; usedRoutes.has(route); n += 1) {
      route = `${group.route}-${n}`;
    }
    usedRoutes.add(route);
    if (route !== group.route) {
      warnings.push(
        `提供方 ${group.route} 出现了多个不同的端点或 API key，已拆成多条路由（本次写入的是 ${route}）`,
      );
    }

    const apiKeyEnv = apiKeyRefOfRoute(route);
    credentials[apiKeyEnv] = group.apiKey;
    piAiProviders[route] = {
      apiKeyEnv,
      api: 'openai-completions',
      baseURL: group.baseURL,
      displayName: mostCommon(group.displayNames) ?? route,
      models: group.models,
    };
    synced += group.models.length;

    if (!defaultModel && group.models.length > 0) {
      defaultModel = { provider: route, model: group.models[0].id };
    }
  }

  return {
    plan: {
      credentials,
      piAiProviders,
      // WorkBuddy 的模型一律走自定义提供方，不用 dsh 内置的 deepseek-official 路由
      deepseek: null,
      defaultModel,
      keylessModels: notices
        .filter((notice) => notice.reason.includes('API key'))
        .map((notice) => notice.name),
      warnings,
    },
    total: models.length,
    synced,
    notices,
  };
}

/** 取出现次数最多的值（WorkBuddy 里同一 provider 的 name 会重复出现在每个模型上） */
function mostCommon(values: string[]): string | undefined {
  const count = new Map<string, number>();
  for (const value of values) {
    count.set(value, (count.get(value) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, times] of count) {
    if (times > bestCount) {
      best = value;
      bestCount = times;
    }
  }
  return best;
}
