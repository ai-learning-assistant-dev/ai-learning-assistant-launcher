/**
 * 把插件清单里的插件装进 dsh 的 profile —— 安装 DeepSeek Harness 时的一个独立环节。
 *
 * dsh 的插件是 profile 级的 pnpm 依赖，官方入口是
 * `dsh plugin --profile <profile> add <pkg>`：dsh 把参数转给 pnpm，装完再把带 `dsh.bundle`
 * 的包登记进 `$DSH_HOME/profiles/<profile>/package.json` 的 `dsh.profile.bundles`。
 * 所以这里只负责「调命令 + 判断装没装」，不改任何 dsh 配置文件。
 *
 * 语义：
 * - 已经装好、且版本满足清单要求的插件直接跳过，不重复跑 pnpm；
 * - 用户自己用 `link:` / `file:` / git 装的同一个包不动它（尊重本地构建），只记一条日志；
 * - 包名 / 版本写法不安全（命令行开关形状、带空白、能换来源的写法）的条目不执行安装；
 *   清单解析阶段已经挡过一次（parseDshPluginIndex），这里是第二层，因为条目类型是导出的、
 *   任何别处构造出来的条目都不该把参数塞进 pnpm；
 * - 单个插件失败只记告警并接着装下一个：插件装不上不应该让 dsh 本身装不上；
 * - 本函数不抛错，结果由调用方汇总提示。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { satisfies } from 'semver';
import type { Exec } from '../exec';
import { loggerFactory } from '../terminal-log';
import type { SyncLogger } from './dsh-config-providers';
import { resolveDshHome } from './dsh-model-sync';
import { isSafePluginName, isSafePluginVersion } from './dsh-plugin-index';
import type { DshPluginEntry } from './dsh-plugin-index';

const DS_LABEL = 'DEEPSEEK_HARNESS';

/** 本启动器只跑 `dsh web`，插件也装进这个 profile（与 dsh-model-sync 保持一致） */
export const DSH_PROFILE = 'web';

/** 一次插件安装的结果，用于日志汇总 */
export interface DshPluginInstallResult {
  /** 这次真正装上 / 升级的插件（`name@版本`） */
  installed: string[];
  /** 跳过的插件（已是最新 / 用户用本地路径装的 / 清单里 enabled:false） */
  skipped: string[];
  /** 失败的插件及原因 */
  failed: Array<{ name: string; reason: string }>;
}

/** dsh 的 profile 目录（插件依赖与 profile manifests 都在这里） */
export function dshProfileDir(): string {
  return path.join(resolveDshHome(), 'profiles', DSH_PROFILE);
}

/** profile 的 package.json（dsh 记录依赖与 bundles 的地方） */
function dshProfileManifestPath(): string {
  return path.join(dshProfileDir(), 'package.json');
}

interface DshProfileManifest {
  dependencies?: Record<string, string>;
}

function readProfileManifest(): DshProfileManifest | null {
  const file = dshProfileManifestPath();
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DshProfileManifest;
  } catch (error) {
    console.warn(
      `[${DS_LABEL}] 解析 dsh profile 的 package.json 失败：`,
      error,
    );
    return null;
  }
}

/**
 * 读出 profile 里实际装着的插件版本（pnpm 把它们链接在 profile 的 node_modules 下）。
 * 读不到（没装 / 链接失效）返回 null。
 */
function readInstalledPluginVersion(name: string): string | null {
  const manifestPath = path.join(
    dshProfileDir(),
    'node_modules',
    ...name.split('/'),
    'package.json',
  );
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch (error) {
    console.warn(`[${DS_LABEL}] 解析已装插件 ${name} 的版本失败：`, error);
    return null;
  }
}

/**
 * 依赖写法是不是「本地 / 仓库」来源（`link:` `file:` `portal:` `workspace:` `git+` `github:` 等）。
 * 这类插件是用户自己接进来的构建产物，用 registry 版本覆盖会破坏他们的环境。
 */
function isLocalOrGitSpec(spec: string): boolean {
  return (
    /^(?:link|file|portal|workspace|git\+|git:|github:|https?:)/i.test(spec) ||
    spec.startsWith('.') ||
    spec.includes('://')
  );
}

/** 清单里的版本写法 → 安装参数（`name@版本`）；latest / 空 就是 `name` */
export function pluginInstallSpec(entry: DshPluginEntry): string {
  const version = (entry.version ?? '').trim();
  if (!version || version === 'latest' || version === '*') {
    return entry.name;
  }
  return `${entry.name}@${version}`;
}

/**
 * 这条目拼出来的参数是否只可能是「包[@版本]」，而不是命令行开关或换来源的写法。
 * 判断规则全部来自 dsh-plugin-index（同一处定义），这里只是第二层把关。
 */
export function isSafeInstallSpec(entry: DshPluginEntry): boolean {
  if (!isSafePluginName(entry.name)) {
    return false;
  }
  const version = (entry.version ?? '').trim();
  return !version || isSafePluginVersion(version);
}

/** 插件当前状态：已满足 / 用户本地装的 / 需要装（或升级） */
export type InstalledPluginState = 'satisfied' | 'local' | 'outdated';

/** 判断插件在 profile 里是否已经满足清单要求 */
export function checkInstalledPlugin(
  entry: DshPluginEntry,
  manifest: DshProfileManifest | null = readProfileManifest(),
): InstalledPluginState {
  const declared = manifest?.dependencies?.[entry.name];
  if (declared && isLocalOrGitSpec(declared)) {
    return 'local';
  }

  const installedVersion = readInstalledPluginVersion(entry.name);
  if (!installedVersion) {
    return 'outdated';
  }

  const desired = (entry.version ?? '').trim();
  // 清单要 latest：每次都让 pnpm 去解析一次最新版本
  if (!desired || desired === 'latest' || desired === '*') {
    return 'outdated';
  }

  try {
    return satisfies(installedVersion, desired, { loose: true })
      ? 'satisfied'
      : 'outdated';
  } catch (error) {
    // 版本范围写法不认识（例如自定义 tag）：不假装满足，交给 pnpm 处理
    console.warn(
      `[${DS_LABEL}] 插件 ${entry.name} 的版本要求 ${desired} 无法判断，交给 pnpm 处理：`,
      error,
    );
    return 'outdated';
  }
}

/**
 * 把执行错误压成一行可读的原因（日志里够用即可）。
 * Exec 抛出的错误把 command / stdout / stderr 全塞在 message 里，这里优先只取 stderr：
 * pnpm / dsh 的真正原因（404、缺 pnpm、版本不兼容、diagnostics 日志路径）都在那里。
 */
function describeError(error: unknown): string {
  const detail = (error as { stderr?: unknown } | null)?.stderr;
  const text =
    typeof detail === 'string' && detail.trim()
      ? detail
      : error instanceof Error
        ? error.message
        : String(error ?? '未知错误');
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 800 ? `${oneLine.slice(0, 800)}…` : oneLine;
}

/**
 * 按清单安装插件。
 * 每个插件单独跑一次 `dsh plugin add`，这样某一个装不上不会连累后面的插件。
 */
export async function installDshPlugins(
  exec: Exec,
  plugins: DshPluginEntry[],
  logger: SyncLogger,
): Promise<DshPluginInstallResult> {
  const result: DshPluginInstallResult = {
    installed: [],
    skipped: [],
    failed: [],
  };

  const targets = plugins.filter((entry) => entry.enabled !== false);
  for (const entry of plugins) {
    if (entry.enabled === false) {
      logger.log(
        `跳过插件 ${entry.name}：清单里标记为 enabled:false（这次不装）`,
      );
      result.skipped.push(entry.name);
    }
  }
  if (targets.length === 0) {
    return result;
  }

  for (const entry of targets) {
    const label = entry.displayName
      ? `${entry.displayName}（${entry.name}）`
      : entry.name;

    // 第二层把关：不安全的包名 / 版本不进命令行（清单解析阶段已经挡过一遍）
    if (!isSafeInstallSpec(entry)) {
      logger.warn(
        `跳过插件 ${entry.name}：包名或版本写法不安全（可能被当成命令行开关），不执行安装`,
      );
      result.skipped.push(entry.name);
      continue;
    }

    const state = checkInstalledPlugin(entry);
    if (state === 'satisfied') {
      logger.log(`插件 ${label} 已安装且版本满足要求，跳过`);
      result.skipped.push(entry.name);
      continue;
    }
    if (state === 'local') {
      logger.log(
        `插件 ${label} 当前是本地路径 / 仓库来源安装的，保留现状不覆盖（如需换成 registry 版本，请在 dsh 里手动重装）`,
      );
      result.skipped.push(entry.name);
      continue;
    }

    const spec = pluginInstallSpec(entry);
    logger.log(
      `安装 dsh 插件 ${label}：dsh plugin --profile ${DSH_PROFILE} add ${spec}`,
    );
    try {
      await exec.exec(
        'dsh',
        ['plugin', '--profile', DSH_PROFILE, 'add', spec],
        { logger: loggerFactory(DS_LABEL) },
      );
      const installedVersion = readInstalledPluginVersion(entry.name);
      if (installedVersion) {
        result.installed.push(`${entry.name}@${installedVersion}`);
        logger.log(`插件 ${label} 安装完成：${installedVersion}`);
      } else {
        // 命令退出码是 0、但 profile 里查不到这个包：dsh 可能把它当普通依赖装了、
        // 或 pnpm 复用了已有 lockfile，这里按失败上报，让用户知道没生效
        result.failed.push({
          name: entry.name,
          reason: '命令执行成功，但 profile 里查不到这个插件（可能未生效）',
        });
        logger.warn(
          `插件 ${label} 装完后在 ${dshProfileDir()} 里查不到，可能未生效`,
        );
      }
    } catch (error) {
      const reason = describeError(error);
      result.failed.push({ name: entry.name, reason });
      logger.warn(`插件 ${label} 安装失败：${reason}`);
    }
  }

  return result;
}
