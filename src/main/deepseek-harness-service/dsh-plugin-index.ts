/**
 * dsh 插件清单：安装 DeepSeek Harness 时要一并装进 dsh 的那些插件。
 *
 * 机制与 `external-resources/dlc/dlc-index.json` 一样，也是「本地一份 + 安装前拉最新一份」：
 * - 本地一份随安装包分发（`external-resources/dsh/dsh-plugin-index.json`）：离线、服务器不可用、
 *   或用户刚装好还没联网时就用它，保证插件环节永远有清单可装；
 * - 安装 dsh 之前先从 {@link DSH_PLUGIN_INDEX_URL} 拉一份最新的，校验通过就覆盖本地那份，
 *   这样「改服务器上的清单」就能改所有用户下次安装时装哪些插件，不必发新版本。
 *
 * 清单格式（远程与本地一致，`plugins` 也可以直接是数组，与 dlc-index.json 的写法一致）：
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "plugins": [
 *     { "name": "dshmarket", "version": "^1.66.22", "enabled": true, "displayName": "插件市场" }
 *   ]
 * }
 * ```
 * - `name`：npm 包名（必填）；
 * - `version`：版本号 / 版本范围，省略或写 `latest` 表示每次安装都装最新；
 * - `enabled`：写 `false` 表示留在清单里但这次不装（默认 true）；
 * - `displayName` / `description`：只用于日志展示，可省略。
 *
 * 清单是外部数据，这里按「不可信输入」处理：逐项校验，非法条目丢掉并记告警，绝不让一份坏清单
 * 变成一堆奇怪的命令参数 —— 这条清单最终会被拼成 `dsh plugin --profile web add <name>@<version>`，
 * 而 dsh 又把参数原样转给 pnpm，所以包名与版本都必须先确认「只可能是包说明符，不可能是开关」：
 * 包名每段不能以 `-` 开头（见 {@link PACKAGE_NAME_RE}），版本只能由版本号 / 范围 / tag 的字符
 * 组成（见 {@link VERSION_RE}）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { appPath } from '../exec';
import type { SyncLogger } from './dsh-config-providers';

/** 远程插件清单地址（与 dlc 索引同一台服务器，路径风格也一致） */
export const DSH_PLUGIN_INDEX_URL =
  'https://learning.panchuantech.cn/dsh/plugins.json';

/** 拉取远程清单的超时时间：清单很小（几 KB），4 秒还没拿回来就直接回退本地那份，不要拖慢安装 */
const INDEX_FETCH_TIMEOUT_MS = 4 * 1000;

/** 清单体积上限：正常只有几 KB，超过就认为是拿错了内容 */
const INDEX_MAX_BYTES = 1024 * 1024;

/** 最多跟随几次重定向 */
const INDEX_MAX_REDIRECTS = 5;

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
 * 最终使用的清单及其来源。
 * 清单本身的问题（条目被丢弃、远程拉取失败）由 {@link loadDshPluginIndex} 直接记日志，
 * 调用方只需要看 `index` / `source`。
 */
export interface DshPluginIndexState {
  /** 可用的清单；null 表示远程与本地两份都不可用 */
  index: DshPluginIndex | null;
  /** remote：用上了安装前下载的最新清单；local：回退本地那份；none：两份都不可用 */
  source: 'remote' | 'local' | 'none';
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

/** 把清单写回本地文件（下次离线安装用的就是这份） */
function saveLocalDshPluginIndex(index: DshPluginIndex): void {
  const file = dshPluginIndexPath();
  const dir = path.dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, `${JSON.stringify(index, undefined, 2)}\n`, 'utf8');
}

// ===== 远程清单 =====

/** GET 一个文本资源（跟随重定向、限时限量） */
function fetchText(
  url: string,
  redirectsLeft = INDEX_MAX_REDIRECTS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? https.get : http.get;
    const request = get(
      url,
      { timeout: INDEX_FETCH_TIMEOUT_MS },
      (response) => {
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new Error(`重定向缺少 location（HTTP ${status}）`));
            return;
          }
          if (redirectsLeft <= 0) {
            reject(new Error('重定向次数过多'));
            return;
          }
          fetchText(new URL(location, url).toString(), redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        let data = '';
        let bytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > INDEX_MAX_BYTES) {
            request.destroy(
              new Error(`清单超过 ${INDEX_MAX_BYTES} 字节，已放弃`),
            );
            return;
          }
          data += chunk;
        });
        response.on('end', () => resolve(data));
        response.on('error', reject);
      },
    );

    request.on('timeout', () => {
      request.destroy(
        new Error(`请求超时（${INDEX_FETCH_TIMEOUT_MS / 1000} 秒）`),
      );
    });
    request.on('error', reject);
  });
}

/** 从远程拉一份最新清单（只解析、不落盘） */
export async function fetchRemoteDshPluginIndex(): Promise<DshPluginIndexParseResult> {
  const text = await fetchText(DSH_PLUGIN_INDEX_URL);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      index: null,
      warnings: [`远程插件清单不是合法 JSON：${String(error)}`],
    };
  }
  return parseDshPluginIndex(raw);
}

// ===== 对外入口 =====

/**
 * 取一份可用的插件清单：先尝试远程最新那份（成功就覆盖本地），失败则回退本地那份。
 * 两条路都走不通时返回 `source: 'none'`，由调用方决定只记日志还是提示用户。
 *
 * 过程中所有非致命问题都写进 `logger`，调用方不需要再逐条转述。
 */
export async function loadDshPluginIndex(
  logger: SyncLogger,
): Promise<DshPluginIndexState> {
  const file = dshPluginIndexPath();

  try {
    const remote = await fetchRemoteDshPluginIndex();
    for (const warning of remote.warnings) {
      logger.warn(warning);
    }
    if (remote.index && remote.index.plugins.length > 0) {
      try {
        saveLocalDshPluginIndex(remote.index);
        logger.log(
          `已从 ${DSH_PLUGIN_INDEX_URL} 获取最新插件清单（${remote.index.plugins.length} 条），本地清单已更新：${file}`,
        );
      } catch (error) {
        // 写不进去（例如安装目录只读）不影响这次安装，用内存里这份继续
        logger.warn(`更新本地插件清单失败（${file}）：${String(error)}`);
      }
      return { index: remote.index, source: 'remote', path: file };
    }
    logger.warn(
      `远程插件清单为空或不可用（${DSH_PLUGIN_INDEX_URL}），改用本地清单：${file}`,
    );
  } catch (error) {
    logger.warn(
      `拉取最新插件清单失败（${DSH_PLUGIN_INDEX_URL}：${String(error)}），改用本地清单：${file}`,
    );
  }

  const local = readLocalDshPluginIndex();
  for (const warning of local.warnings) {
    logger.warn(warning);
  }
  if (!local.index || local.index.plugins.length === 0) {
    return { index: null, source: 'none', path: file };
  }
  logger.log(`使用本地插件清单：${file}（${local.index.plugins.length} 条）`);
  return { index: local.index, source: 'local', path: file };
}
