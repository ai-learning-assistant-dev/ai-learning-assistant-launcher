/**
 * dsh 插件清单：安装 DeepSeek Harness 时要一并装进 dsh 的那些插件。
 *
 * 现在清单里**只有一条** `@commonworks/dsh-starter`：插件安装这件事已经交给它 ——
 * starter 会按用户选的场景（法律财务 / 办公 / 生活 / 学习 / 开发 / 媒体）在 dsh 首次会话里
 * 检查并装好该场景真正需要的插件，所以启动器不再自己维护「一长串插件」的清单。
 *
 * 清单只随安装包分发（`external-resources/dsh/dsh-plugin-index.json`），安装前不再从服务器
 * 拉取覆盖。以前那套「本地一份 + 安装前拉远程最新一份覆盖本地」的机制会直接架空「只装 starter」：
 * 只要服务器上还留着旧的大清单，用户装 dsh 时照样会被装上一大堆插件。要改装什么，
 * 改这份本地 JSON 并重新打包，或者让用户在 dsh 里手动装。
 *
 * 清单格式：
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "plugins": [
 *     { "name": "@commonworks/dsh-starter", "version": "latest", "enabled": true, "displayName": "场景起步包" }
 *   ]
 * }
 * ```
 * - `name`：npm 包名（必填）；
 * - `version`：版本号 / 版本范围，省略或写 `latest` 表示每次安装都装最新；
 * - `enabled`：写 `false` 表示留在清单里但这次不装（默认 true）；
 * - `displayName` / `description`：只用于日志展示，可省略。
 *
 * 清单仍按「不可信输入」处理（它是随包文件，但可能被人手改错）：逐项校验，非法条目丢掉并记告警，
 * 绝不让一份坏清单变成一堆奇怪的命令参数 —— 这条清单最终会被拼成
 * `dsh plugin --profile desktop add <name>@<version>`，而 dsh 又把参数原样转给 pnpm，
 * 所以包名与版本都必须先确认「只可能是包说明符，不可能是开关」：
 * 包名每段不能以 `-` 开头（见 {@link PACKAGE_NAME_RE}），版本只能由版本号 / 范围 / tag 的字符
 * 组成（见 {@link VERSION_RE}）。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appPath } from '../exec';
import type { SyncLogger } from './dsh-config-providers';

/** 清单里最多认多少条插件：防止一份坏清单让安装流程跑几十次 pnpm */
const MAX_PLUGINS = 50;

/** 清单里的一项插件 */
export interface DshPluginEntry {
  /** npm 包名 */
  name: string;
  /** 版本号 / 版本范围；省略表示 latest */
  version?: string;
  /** 日志里显示的名字，省略时用包名 */
  displayName?: string;
  /** 一句话说明，只用于日志 */
  description?: string;
  /** false 表示这次不装（默认 true） */
  enabled: boolean;
}

/** 一份插件清单 */
export interface DshPluginIndex {
  schemaVersion: number;
  plugins: DshPluginEntry[];
}

/** 解析清单的结果：`index` 为 null 表示这份清单不能用 */
export interface DshPluginIndexParseResult {
  index: DshPluginIndex | null;
  /** 非致命问题（条目被丢弃等），由调用方记日志 */
  warnings: string[];
}

/**
 * 最终使用的清单。
 * 清单本身的问题（条目被丢弃、文件缺失）由 {@link loadDshPluginIndex} 直接记日志，
 * 调用方只需要看 `index`。
 */
export interface DshPluginIndexState {
  /** 可用的清单；null 表示清单不可用 */
  index: DshPluginIndex | null;
  /** 清单文件路径 */
  path: string;
}

/** 本地清单文件路径（随安装包分发：forge 的 postPackage 会整份复制 external-resources） */
export function dshPluginIndexPath(): string {
  return path.join(
    appPath,
    'external-resources',
    'dsh',
    'dsh-plugin-index.json',
  );
}

// ===== 清单解析与校验 =====

/**
 * npm 包名（含 scope）的合法写法，用来把非法条目挡在命令行之外。
 * 关键：每段的**首字符不允许是 `-`**，否则 `-bad` / `--force` / `@scope/--flag` 这类
 * 「开关形状」的名字会原样进到 `dsh plugin ... add <name>`，被转手的 pnpm 当成参数解析。
 */
const PACKAGE_NAME_RE =
  /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/i;

/**
 * 版本写法允许的字符：版本号、semver 范围与 tag。
 * 刻意不含空白、`/`、`:`、`\`、引号 —— 那样 `name@<version>` 就只可能被解析成「包@版本」，
 * 变不成 `name@owner/repo`（GitHub 简写）或 `name:git+https://…` 这类换来源的写法。
 */
const VERSION_RE = /^[0-9A-Za-z.\-+><=|^~*]+$/;

/** 包名是否安全（导出给安装那一步做二次把关：规则只有这一处） */
export function isSafePluginName(name: string): boolean {
  return PACKAGE_NAME_RE.test(name);
}

/** 版本写法是否安全（同样导出，保证安装那一步用的是同一条规则） */
export function isSafePluginVersion(version: string): boolean {
  return VERSION_RE.test(version) && !version.startsWith('-');
}

/**
 * 版本写法校验：空 / latest 放行；写法非法时返回 `drop`，让整条插件被丢掉 ——
 * 与其猜一个版本，不如不装：清单写错就什么都不做，比装了个计划外的版本更好排查。
 */
function normalizeVersion(
  raw: unknown,
  name: string,
): { version?: string; warning?: string; drop?: boolean } {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== 'string') {
    return {
      warning: `插件 ${name} 的 version 不是字符串，已忽略这条`,
      drop: true,
    };
  }
  const version = raw.trim();
  if (!version) {
    return {};
  }
  if (!isSafePluginVersion(version)) {
    return {
      warning: `插件 ${name} 的 version（${version}）不是版本号 / 版本范围 / tag 的写法，已忽略这条`,
      drop: true,
    };
  }
  return { version };
}

/** 校验清单里的一项；返回 entry 或一条告警 */
function normalizeEntry(raw: unknown): {
  entry?: DshPluginEntry;
  warning?: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { warning: '插件清单里有一项不是对象，已忽略' };
  }
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return { warning: '插件清单里有一项缺少 name，已忽略' };
  }
  if (!isSafePluginName(name)) {
    return {
      warning: `插件清单里的包名 ${name} 不合法（不能以 - / . 开头，也不能是命令行开关的形状），已忽略`,
    };
  }

  const { version, warning, drop } = normalizeVersion(record.version, name);
  if (drop) {
    return { warning };
  }
  const entry: DshPluginEntry = {
    name,
    enabled: record.enabled !== false,
  };
  if (version) {
    entry.version = version;
  }
  for (const key of ['displayName', 'description'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      entry[key] = value.trim();
    }
  }
  return warning ? { entry, warning } : { entry };
}

/**
 * 把清单 JSON 解析成内部结构。
 * 兼容两种根结构：`{ plugins: [...] }` 与直接数组（dlc-index.json 就是数组）。
 */
export function parseDshPluginIndex(raw: unknown): DshPluginIndexParseResult {
  const warnings: string[] = [];
  let list: unknown[] | null = null;
  let schemaVersion = 1;

  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (typeof record.schemaVersion === 'number') {
      schemaVersion = record.schemaVersion;
    }
    if (Array.isArray(record.plugins)) {
      list = record.plugins;
    }
  }

  if (!list) {
    return {
      index: null,
      warnings: ['插件清单格式不正确：缺少 plugins 数组'],
    };
  }

  const seen = new Set<string>();
  const plugins: DshPluginEntry[] = [];
  for (const item of list) {
    if (plugins.length >= MAX_PLUGINS) {
      warnings.push(`插件清单超过 ${MAX_PLUGINS} 条，多余条目已忽略`);
      break;
    }
    const { entry, warning } = normalizeEntry(item);
    if (warning) {
      warnings.push(warning);
    }
    if (!entry) {
      continue;
    }
    if (seen.has(entry.name)) {
      warnings.push(`插件清单里 ${entry.name} 重复出现，只保留第一条`);
      continue;
    }
    seen.add(entry.name);
    plugins.push(entry);
  }

  return { index: { schemaVersion, plugins }, warnings };
}

// ===== 本地清单 =====

/** 读取本地那份清单；文件不存在 / 解析失败返回 null（原因在 warnings 里） */
export function readLocalDshPluginIndex(): DshPluginIndexParseResult {
  const file = dshPluginIndexPath();
  if (!existsSync(file)) {
    return { index: null, warnings: [`本地插件清单不存在：${file}`] };
  }
  try {
    return parseDshPluginIndex(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    return {
      index: null,
      warnings: [`解析本地插件清单失败（${file}）：${String(error)}`],
    };
  }
}

// ===== 对外入口 =====

/**
 * 取一份可用的插件清单：只读随包分发的那份。
 * 读不到时返回 `index: null`，由调用方决定只记日志还是提示用户。
 *
 * 清单本身的所有非致命问题都写进 `logger`，调用方不需要再逐条转述。
 */
export function loadDshPluginIndex(logger: SyncLogger): DshPluginIndexState {
  const file = dshPluginIndexPath();

  const local = readLocalDshPluginIndex();
  for (const warning of local.warnings) {
    logger.warn(warning);
  }
  if (!local.index || local.index.plugins.length === 0) {
    return { index: null, path: file };
  }
  logger.log(`使用本地插件清单：${file}（${local.index.plugins.length} 条）`);
  return { index: local.index, path: file };
}
