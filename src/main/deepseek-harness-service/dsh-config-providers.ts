/**
 * 把同步计划写进 dsh 的配置文件（dsh 0.2.0 起的新布局）。
 *
 * dsh 0.2.0 重写了配置存储，旧版那套可复用的配置包被一并移除：
 * - `@deepseek-ai/dsh-settings-file`（`$DSH_HOME/settings.yaml` 的 provider）已删除，
 *   模型路由改写到按 profile 组织的「补丁层」`$DSH_HOME/profiles/<profile>/cordis.patch.yml`；
 * - `@deepseek-ai/dsh-credentials-local` 仍存在，但凭据文档从平铺的 `ref: value`
 *   升级为带版本的 `version: 1` + `refs:` / `records:` 两段。
 *
 * 因此这里不再动态 import dsh 的包（`dsh-settings-file` 已解析不到，装了也没法用），
 * 而是直接按新格式写文件：
 * - `$DSH_HOME/.credentials.yaml`：只写 refs（API key），保留 records
 *   （例如浏览器会话的签名密钥），并顺带把旧的平铺布局升级成带版本布局；
 * - `$DSH_HOME/profiles/<profile>/cordis.patch.yml`：模型路由写成针对
 *   `llm-pi-ai` / `llm-deepseek` / `web-search-deepseek` / `agent-default-model`
 *   这几个插件 entry 的 id 覆盖补丁（YAML 数组，每项 `{ id, name, config }`）。
 *
 * 写入语义：settings 侧沿用 model-sync-plan 的叶子级合并（保留 dsh 里已有的其它路由 /
 * 字段），凭据侧合并进现有 refs、绝不覆盖 records。dsh 的 loader / 配置编辑器会热加载这两个
 * 文件，所以直接写文件与「在 dsh 界面里改」落到的是同一份配置。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dump, load } from 'js-yaml';
import { mergeModelSyncIntoSettings } from './model-sync-plan';
import type { ModelSyncPlan } from './model-sync-plan';

/** 同步过程的日志出口（由 index.ts 接到界面命令行日志 / launcher.log） */
export interface SyncLogger {
  log(message: string): void;
  warn(message: string, cause?: unknown): void;
}

/** 模型相关插件的补丁 entry id → 包名（补丁按 id 覆盖，name 用于一致性校验） */
const PATCH_ENTRY_NAMES: Record<string, string> = {
  'llm-pi-ai': '@deepseek-ai/dsh-llm-pi-ai',
  'llm-deepseek': '@deepseek-ai/dsh-llm-deepseek-api-key',
  'web-search-deepseek': '@deepseek-ai/dsh-web-search-deepseek',
  'agent-default-model': '@deepseek-ai/dsh-agent-default-model',
};

/** 凭据文档的当前版本号（与 dsh-credentials-local 的 DOCUMENT_VERSION 一致） */
const CREDENTIALS_DOCUMENT_VERSION = 1;

/**
 * 补丁文件里的一项。除 `id` / `name` / `config` 外，还可能是不带 id 的
 * `insert` 列表、`disabled` 覆盖等，这里按「任意映射」原样保留，只改 id 命中的项。
 */
type PatchEntry = Record<string, unknown> & { id?: string };

/** 解析出来的凭据文档（只关心 refs 与 records 两段） */
interface CredentialsDocument {
  refs: Record<string, string>;
  records: unknown;
}

// ===== 凭据（.credentials.yaml） =====

/**
 * 读取现有凭据文档。兼容带版本的新布局（`version: 1` + `refs:`/`records:`）与
 * 旧的平铺布局（顶层就是 `ref: value`）；文件不存在返回空。
 */
function readCredentials(credentialsPath: string): CredentialsDocument {
  if (!existsSync(credentialsPath)) {
    return { refs: {}, records: undefined };
  }
  const parsed = load(readFileSync(credentialsPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { refs: {}, records: undefined };
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.version === CREDENTIALS_DOCUMENT_VERSION) {
    const refs = (doc.refs && typeof doc.refs === 'object'
      ? doc.refs
      : {}) as Record<string, string>;
    return { refs, records: doc.records };
  }
  // 旧平铺布局：除 version 外的顶层字符串键都是 ref，升级时保留
  const refs: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key !== 'version' && typeof value === 'string') {
      refs[key] = value;
    }
  }
  return { refs, records: undefined };
}

/** 把新 refs 合并进凭据文档并落盘：保留 records，统一写成带版本布局 */
function writeCredentials(
  credentialsPath: string,
  refs: Record<string, string>,
): void {
  const existing = readCredentials(credentialsPath);
  const document: Record<string, unknown> = {
    version: CREDENTIALS_DOCUMENT_VERSION,
    refs: { ...existing.refs, ...refs },
  };
  if (existing.records !== undefined) {
    document.records = existing.records;
  }
  mkdirSync(dirname(credentialsPath), { recursive: true });
  // 0600：凭据文件只允许属主读写（POSIX 下 dsh-credentials-local 会校验这一点）
  writeFileSync(credentialsPath, dump(document, { lineWidth: -1, noRefs: true }), {
    mode: 0o600,
  });
}

// ===== 模型路由（profiles/<profile>/cordis.patch.yml） =====

/** 读取现有补丁（YAML 数组），不存在返回空；非映射项（理论不存在）被过滤掉 */
function readPatchEntries(patchPath: string): PatchEntry[] {
  if (!existsSync(patchPath)) {
    return [];
  }
  const parsed = load(readFileSync(patchPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (entry): entry is PatchEntry =>
      !!entry && typeof entry === 'object' && !Array.isArray(entry),
  ) as PatchEntry[];
}

/** 把 sections 里的每个 entry id 覆盖进补丁数组并落盘；其它项（insert/disabled 等）原样保留 */
function writePatchEntries(
  patchPath: string,
  sections: Record<string, unknown>,
): void {
  const entries = readPatchEntries(patchPath);
  const byId = new Map<string, PatchEntry>();
  for (const entry of entries) {
    if (typeof entry.id === 'string') {
      byId.set(entry.id, entry);
    }
  }

  for (const [id, config] of Object.entries(sections)) {
    const name = PATCH_ENTRY_NAMES[id];
    const existing = byId.get(id);
    if (existing) {
      existing.config = config;
      if (name && !existing.name) {
        existing.name = name;
      }
    } else {
      const entry: PatchEntry = { id, config };
      if (name) {
        entry.name = name;
      }
      entries.push(entry);
    }
  }

  mkdirSync(dirname(patchPath), { recursive: true });
  writeFileSync(patchPath, dump(entries, { lineWidth: -1, noRefs: true }));
}

// ===== 对外入口 =====

/**
 * 把同步计划写进 dsh 的配置文件（凭据 + 模型路由）。
 *
 * @returns 写入摘要；写入过程抛错时返回 `null`（调用方只记日志，提示用户去 dsh 界面里手动配）
 */
export async function applyModelSyncToDshConfig(options: {
  plan: ModelSyncPlan;
  profilePatchPath: string;
  credentialsPath: string;
  logger: SyncLogger;
}): Promise<string[] | null> {
  const { plan, profilePatchPath, credentialsPath, logger } = options;

  try {
    const summary: string[] = [];

    // 1) 凭据：plan.credentials 里只会有非空密钥
    const refs = Object.entries(plan.credentials);
    if (refs.length > 0) {
      writeCredentials(credentialsPath, plan.credentials);
      summary.push(`${refs.length} 个凭据`);
    }

    // 2) 模型路由 / 默认模型：把现有补丁读成 document（entry id → config），
    //    交给 model-sync-plan 做叶子级合并，再按分节写回补丁文件
    const document: Record<string, unknown> = {};
    for (const entry of readPatchEntries(profilePatchPath)) {
      if (typeof entry.id === 'string') {
        document[entry.id] = entry.config ?? {};
      }
    }
    const { sections, summary: settingsSummary } = mergeModelSyncIntoSettings(
      document,
      plan,
    );
    if (Object.keys(sections).length > 0) {
      writePatchEntries(profilePatchPath, sections);
    }
    summary.push(...settingsSummary);

    return summary;
  } catch (error) {
    logger.warn('写入 dsh 配置失败', error);
    return null;
  }
}
