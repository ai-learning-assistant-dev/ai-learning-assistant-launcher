import { IpcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  queryDeepseekHarnessServiceHandle,
  installDeepseekHarnessServiceHandle,
  removeDeepseekHarnessServiceHandle,
  syncWorkbuddyModelsToDshHandle,
  openDeepseekHarnessBackupDirHandle,
  installDshPluginsHandle,
  DeepseekHarnessServiceInfo,
  DshPluginInstallSummary,
  WorkbuddyModelSyncResult,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import { Exec } from '../exec';
import { loggerFactory } from '../terminal-log';
import { getLlmConfig } from '../configs';
import { setNpmRegistryTaobaoGlobal } from '../node-toolchain';
import type { SyncLogger } from './dsh-config-providers';
import {
  createDshSyncLogger,
  dshBackupRoot,
  dshProfilePatchPath,
  syncModelsIntoDshHarness,
  syncWorkbuddyModelsIntoDshHarness,
} from './dsh-model-sync';
import { dshPluginIndexPath, loadDshPluginIndex } from './dsh-plugin-index';
import { dshProfileDir, installDshPlugins } from './dsh-plugin-install';
import {
  DSH_DESKTOP_DOWNLOAD_PAGE,
  findDshDesktopInstall,
  findDshDesktopProcess,
  installDshDesktop,
  launchDshDesktop,
  readDshCommandVersion,
  stopDshDesktop,
  uninstallDshDesktop,
  type DshDesktopInstall,
} from './dsh-desktop';

/**
 * DeepSeek Harness（dsh）服务：
 * - 安装方式：下载官网 https://www.deepseek.com/harness/ 提供的 Windows 安装包并静默安装
 *   （安装包自带 Node、pnpm 和 dsh CLI，不需要系统预装 Node / npm）
 * - 启动 / 停止由桌面版自己负责：启动器只负责安装、卸载、同步模型和装插件，
 *   不再提供运行 / 打开界面 / 停止按钮（不再跑 `dsh web`）；
 *   装插件 / 卸载时会按需结束桌面版进程，装插件前若桌面版开着会先关掉它
 * - 模型与插件都写进桌面版保留的 `desktop` profile，而不是以前的 `web`：
 *   模型写 `$DSH_HOME/profiles/desktop/cordis.patch.yml`（DeepSeek 官方提供方写
 *   `llm-deepseek`，其余模型写 `llm-pi-ai` 自定义提供方），非空 API key 写进
 *   `$DSH_HOME/.credentials.yaml`；插件用 `dsh plugin --profile desktop add` 安装
 */

const DS_LABEL = 'DEEPSEEK_HARNESS';

const commandLine = new Exec();

/** 首次启动桌面版并等待它初始化 `desktop` profile 的上限 */
const DESKTOP_PROFILE_INIT_TIMEOUT_MS = 90 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 统一日志入口：同一条日志同时写 console（主进程 console 已接入 electron-log，落盘 launcher.log）
 * 和界面命令行日志（terminal-log 通道）。本文件所有日志都应走这里，不要直接 console.log/warn/error。
 */
const logger = {
  log(message: string, ...rest: unknown[]): void {
    console.log(message, ...rest);
    loggerFactory(DS_LABEL).log(
      rest.length === 0 ? message : `${message} ${rest.map(String).join(' ')}`,
    );
  },
  warn(message: string, ...rest: unknown[]): void {
    console.warn(message, ...rest);
    loggerFactory(DS_LABEL).warn(
      rest.length === 0 ? message : `${message} ${rest.map(String).join(' ')}`,
    );
  },
  error(message: string, ...rest: unknown[]): void {
    console.error(message, ...rest);
    loggerFactory(DS_LABEL).error(
      rest.length === 0 ? message : `${message} ${rest.map(String).join(' ')}`,
    );
  },
};

/**
 * 统一的抛错函数：一次完成三件事 —— 落盘日志、界面命令行日志、抛出错误。
 * cause 为底层错误（例如 exec/写文件的报错），只用于日志，会拼进同一行。
 */
function throwWithLog(message: string, cause?: unknown): never {
  const detail = cause === undefined ? '' : `（${cause}）`;
  const line = `[${DS_LABEL}] ${message}${detail}`;
  logger.error(line);
  throw new Error(message);
}

// ===== 桌面版安装与进程状态 =====
//
// 安装 / 卸载 / 进程查找都在 dsh-desktop.ts 里；这里只组合业务动作：
// 启动桌面版、等待 desktop profile 初始化、判断是否在运行。

/** 桌面版是否在运行（按安装目录里的主程序进程判断） */
async function isDshDesktopRunning(
  install: DshDesktopInstall,
): Promise<boolean> {
  return (await findDshDesktopProcess(install.installDir, syncLogger)) !== null;
}

/**
 * 确保桌面版的 `desktop` profile 已初始化。
 *
 * 这个 profile 是桌面版保留的，只能由桌面应用自己创建（`dsh --profile desktop`
 * 会被拒绝），所以没初始化时先启动一次桌面版、等 `package.json` 出现；
 * 随后关掉它，保证后面装插件 / 写模型配置时没有运行中的实例占着 profile 文件锁。
 */
async function ensureDesktopProfileInitialized(
  install: DshDesktopInstall,
): Promise<void> {
  const manifest = path.join(dshProfileDir(), 'package.json');
  if (existsSync(manifest)) {
    return;
  }

  logger.log(
    `[${DS_LABEL}] 桌面版配置还没初始化，先启动一次桌面版完成初始化 ...`,
  );
  await launchDshDesktop(install, syncLogger);

  const deadline = Date.now() + DESKTOP_PROFILE_INIT_TIMEOUT_MS;
  while (Date.now() < deadline && !existsSync(manifest)) {
    await delay(1000);
  }
  if (!existsSync(manifest)) {
    logger.warn(
      `[${DS_LABEL}] 等待桌面版初始化配置超时（${manifest}）；插件可能装不上，模型配置会在桌面版启动后生效`,
    );
    return;
  }

  // 再等一会儿，让桌面版把 pnpm-workspace.yaml / cordis.patch.yml 也写完再关
  await delay(2000);
  await stopDshDesktop(install, syncLogger);
  logger.log(`[${DS_LABEL}] 桌面版配置已初始化：${dshProfileDir()}`);
}

// ===== 大模型配置同步（cordis.patch.yml / .credentials.yaml） =====
//
// - 换算规则（哪些模型写哪条路由、哪些密钥写进凭据）：model-sync-plan.ts
// - 写入：dsh-config-providers.ts —— 直接按 dsh 0.2.0 的新文件布局写
//   `$DSH_HOME/profiles/desktop/cordis.patch.yml` 与 `$DSH_HOME/.credentials.yaml`
// - 对外入口：dsh-model-sync.ts —— 安装流程与模型配置页的「同步 API key」按钮共用
//
// 写入失败只记日志，不阻断安装：让用户在 dsh 的模型页（设置 → 模型）里自己配。

/** 给配置写入用的日志出口 */
const syncLogger: SyncLogger = createDshSyncLogger();

/** 写文件失败时的统一提示：不阻断安装，交给用户在 dsh 界面里配 */
function logManualConfigHint(reason: string): void {
  logger.warn(
    `[${DS_LABEL}] ${reason}；已跳过模型配置同步，不影响 dsh 本身运行。` +
      `请在 dsh 界面的「设置 → 模型」里手动添加提供方与 API key（或在 ${dshProfilePatchPath()} 里手写配置）`,
  );
}

/**
 * 用本项目的大模型配置初始化 dsh：写模型路由与凭据。
 * 没有配置模型、或写入失败时只警告，不阻断安装。
 */
async function onboardDeepseekHarness(): Promise<void> {
  const summary = await syncModelsIntoDshHarness({
    models: getLlmConfig().models ?? [],
    logger: syncLogger,
  });

  if (summary === null) {
    logManualConfigHint('写入 dsh 配置文件失败');
    return;
  }
  if (summary.length === 0) {
    // 具体原因（没有模型 / 全是没有密钥的模型）已由 syncModelsIntoDshHarness 记过日志
    return;
  }
  logger.log(
    `[${DS_LABEL}] 已写入 dsh 配置（.credentials.yaml / cordis.patch.yml）：${summary.join('；')}`,
  );
}

// ===== dsh 插件安装（安装 dsh 的一步，也是界面上的「安装插件」按钮） =====
//
// - 清单：`external-resources/dsh/dsh-plugin-index.json`（随安装包分发，离线时用它）
// - 安装前先从 `DSH_PLUGIN_INDEX_URL` 拉一份最新的覆盖本地那份（拉不到就用本地那份）
// - 调 `dsh plugin --profile desktop add <pkg>` 装进桌面版的 profile，
//   dsh 自己负责把带 dsh.bundle 的包登记进 `dsh.profile.bundles`
// - 桌面版运行时会独占 profile 文件锁：装插件前先关闭桌面版，装完按需重新启动
//
// 两个入口共用 {@link runDshPluginInstall}：
// - 安装流程（installDeepseekHarnessService）：插件装不上只记告警，不阻断 dsh 安装本身；
// - 界面「安装插件」按钮（installDeepseekHarnessPlugins）：给已经装好 dsh 的用户补装 / 升级，
//   不重装 dsh、也不改模型配置，前置条件不满足时抛错，由界面直接提示缺什么。

/**
 * 按清单安装 / 升级 dsh 插件，返回汇总。
 * 单个插件装不上不算失败（进 `failed`，原因写在日志里）；前置条件不满足时抛错。
 */
async function runDshPluginInstall(): Promise<DshPluginInstallSummary> {
  const install = await findDshDesktopInstall(syncLogger);
  if (!install) {
    throw new Error('还没有安装 DeepSeek Harness 桌面版，请先安装再装插件');
  }

  // 桌面版还没启动过时 desktop profile 不存在，dsh plugin 会拒绝执行；
  // 先启动一次让桌面版完成初始化（结束后会关掉）
  await ensureDesktopProfileInitialized(install);

  const state = await loadDshPluginIndex(syncLogger);
  if (!state.index || state.index.plugins.length === 0) {
    throw new Error(
      `没有可用的 dsh 插件清单（远程与本地都不可用）：${state.path}`,
    );
  }

  // 桌面版运行时会占着 profile 的 package.json 文件锁，pnpm 拿不到锁会一直等；
  // 所以装插件前先关掉桌面版，装完由用户自己重新打开。
  const runningBefore = await isDshDesktopRunning(install);
  if (runningBefore) {
    logger.log(
      `[${DS_LABEL}] 安装插件需要独占 desktop profile，先关闭 DeepSeek Harness 桌面版 ...`,
    );
    const stopped = await stopDshDesktop(install, syncLogger);
    if (!stopped) {
      throw new Error(
        '无法关闭 DeepSeek Harness 桌面版（可能还有进程在运行），请手动退出后重试',
      );
    }
  }

  const result = await installDshPlugins(
    commandLine,
    install.command,
    state.index.plugins,
    syncLogger,
  );

  // 能走到这里说明清单可用，所以来源只会是远程或本地
  const source = state.source === 'remote' ? 'remote' : 'local';
  if (result.installed.length > 0) {
    logger.log(`[${DS_LABEL}] 已安装 dsh 插件：${result.installed.join('、')}`);
  }
  logger.log(
    `[${DS_LABEL}] dsh 插件环节结束：新装 ${result.installed.length} 个，跳过 ${
      result.skipped.length
    } 个，失败 ${result.failed.length} 个（清单来源：${
      source === 'remote' ? '远程最新' : '本地'
    }）`,
  );
  if (result.failed.length > 0) {
    logger.warn(
      `[${DS_LABEL}] 以下插件没装上，已跳过、不影响 dsh 本身运行（可在 dsh 界面的插件市场里手动安装）：${result.failed
        .map((item) => `${item.name}（${item.reason}）`)
        .join('；')}`,
    );
  }
  if (result.installed.length > 0 && runningBefore) {
    logger.warn(
      `[${DS_LABEL}] 安装插件前已关闭桌面版；请手动重新打开 DeepSeek Harness，新插件才会加载`,
    );
  }

  return {
    source,
    indexPath: state.path,
    total: state.index.plugins.length,
    installed: result.installed,
    skipped: result.skipped,
    failed: result.failed,
    running: runningBefore,
  };
}

/**
 * 安装流程里的插件环节：任何失败都只记日志，保证 dsh 安装能继续走完。
 */
async function installSelectedDshPlugins(): Promise<void> {
  logger.log(
    `[${DS_LABEL}] 开始安装 dsh 插件（清单：${dshPluginIndexPath()}）...`,
  );
  try {
    await runDshPluginInstall();
  } catch (error) {
    logger.warn(
      `[${DS_LABEL}] 安装 dsh 插件时出错，已跳过（不影响 dsh 本身安装与运行）：`,
      error,
    );
  }
}

// ===== 卸载前关闭桌面版 =====

/** 关闭桌面版；返回是否确认已经没有桌面版进程 */
async function stopDshDesktopInternal(): Promise<boolean> {
  const install = await findDshDesktopInstall(syncLogger);
  if (!install) {
    logger.log(`[${DS_LABEL}] 没有安装 DeepSeek Harness 桌面版，无需停止`);
    return true;
  }

  const stopped = await stopDshDesktop(install, syncLogger);
  if (stopped) {
    logger.log(`[${DS_LABEL}] DeepSeek Harness 桌面版已关闭`);
  } else {
    logger.warn(
      `[${DS_LABEL}] DeepSeek Harness 桌面版未能关闭（仍检测到进程）`,
    );
  }
  return stopped;
}

// ===== IPC 导出的业务函数 =====

export async function queryDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  try {
    const install = await findDshDesktopInstall(syncLogger);
    if (!install) {
      return { state: 'not_install' };
    }
    const version =
      install.version ??
      (await readDshCommandVersion(install.command)) ??
      undefined;
    return { state: 'installed', version };
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 查询服务失败:`, e);
    return { state: 'not_install' };
  }
}

export async function installDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  // 插件走 pnpm / npm registry，先把源设成国内镜像（写入 ~/.npmrc，桌面版内置 pnpm 也会读）
  setNpmRegistryTaobaoGlobal();

  let install = await findDshDesktopInstall(syncLogger);
  if (install?.version) {
    logger.log(
      `[${DS_LABEL}] 已检测到官网安装包装好的 DeepSeek Harness v${install.version}，复用现有安装（不重复安装）`,
    );
  } else {
    if (process.platform !== 'win32') {
      throwWithLog('DeepSeek Harness 官网安装包目前只支持 Windows 系统');
    }
    // 官网安装包自带 Node / pnpm / dsh，不需要系统预装任何运行时
    logger.log(
      `[${DS_LABEL}] 未检测到已安装的 DeepSeek Harness，开始下载官网安装包（${DSH_DESKTOP_DOWNLOAD_PAGE}）...`,
    );
    install = await installDshDesktop(syncLogger);

    // 用安装包自带的 dsh 命令确认真的能跑，而不是只看注册表
    const version = await readDshCommandVersion(install.command);
    if (!version) {
      throwWithLog(
        `安装包已装到 ${install.installDir}，但自带的 dsh 命令无法运行，请重新运行安装或手动打开 DeepSeek Harness 检查`,
      );
    }
    logger.log(
      `[${DS_LABEL}] DeepSeek Harness 安装完成：v${version}（${install.installDir}）`,
    );
  }

  // 插件和模型配置都写进桌面版保留的 desktop profile；首次安装时这个 profile
  // 只有桌面版自己会创建，所以先启动一次让它初始化
  await ensureDesktopProfileInitialized(install);

  // 安装本项目挑选的 dsh 插件（清单本地有一份，安装前会先拉一份最新的）
  await installSelectedDshPlugins();

  // 用本项目的大模型配置初始化 dsh（cordis.patch.yml + .credentials.yaml）
  logger.log(`[${DS_LABEL}] 使用项目大模型配置同步 dsh 的模型配置 ...`);
  await onboardDeepseekHarness();

  return queryDeepseekHarnessService();
}

export async function removeDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  const stopped = await stopDshDesktopInternal();
  if (!stopped) {
    throwWithLog(
      'DeepSeek Harness 桌面版仍在运行，且未能关闭，已停止卸载。请手动退出桌面版后重试',
    );
  }

  const install = await findDshDesktopInstall(syncLogger);
  if (!install) {
    logger.warn(`[${DS_LABEL}] 未检测到已安装的 DeepSeek Harness，跳过卸载`);
    return queryDeepseekHarnessService();
  }

  // 跑安装包自己注册的卸载程序（QuietUninstallString，/currentuser /S）
  logger.log(`[${DS_LABEL}] 开始卸载官网安装包（${install.installDir}）...`);
  try {
    await uninstallDshDesktop(install, syncLogger);
  } catch (e) {
    throwWithLog('卸载 DeepSeek Harness 失败', e);
  }

  return queryDeepseekHarnessService();
}

// ===== 从 WorkBuddy 同步模型配置 =====

/**
 * 把 WorkBuddy 的自定义模型配置（`%USERPROFILE%\.workbuddy\models.json`）同步进 dsh。
 *
 * 写入前会把 `settings.yaml` / `.credentials.yaml` 整份备份到 `$DSH_HOME/backups/<时间戳>/`，
 * 备份结果随返回值一起交给界面展示（用户想回滚时直接拷回这两个文件即可）。
 *
 * 失败时抛出可直接展示给用户的错误（读不到 WorkBuddy 配置、没有可同步的模型、
 * dsh 自带的配置包不可用等）；抛错时还没有写任何东西。
 */
export async function syncWorkbuddyModelsToDsh(): Promise<WorkbuddyModelSyncResult> {
  const outcome = await syncWorkbuddyModelsIntoDshHarness({
    logger: syncLogger,
  });

  if (outcome === null) {
    logManualConfigHint('未能通过 dsh 自带的配置包写入 WorkBuddy 的模型配置');
    throw new Error(
      '未能使用 dsh 自带的配置包写入配置（可能尚未安装 dsh）。请在 dsh 界面的「设置 → 模型」里手动添加提供方与 API key',
    );
  }

  logger.log(
    `[${DS_LABEL}] 已把 WorkBuddy 的模型配置同步进 dsh（${outcome.syncedModels} 个模型 / ${
      outcome.routeCount
    } 条路由）：${outcome.summary.join('；')}`,
  );

  const workbuddyModelCount = outcome.syncedModels + outcome.notices.length;
  return {
    workbuddyModelCount,
    syncedModelCount: outcome.syncedModels,
    routeCount: outcome.routeCount,
    summary: outcome.summary,
    backup: {
      dir: outcome.backup.dir,
      files: outcome.backup.files,
      reused: outcome.backup.reused,
    },
    paths: outcome.paths,
    notices: outcome.notices,
    warnings: outcome.warnings,
  };
}

/**
 * 在系统文件管理器里打开 dsh 配置的备份目录。
 * 只允许打开 dsh home 下的备份目录，避免这条 IPC 被当成任意路径打开器。
 */
export async function openDeepseekHarnessBackupDir(
  dir?: string,
): Promise<string> {
  const root = dshBackupRoot();
  const target = (dir ?? '').trim() || root;

  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error(`只能打开 dsh 配置的备份目录：${root}`);
  }
  if (!existsSync(normalizedTarget)) {
    throw new Error(`备份目录还不存在：${normalizedTarget}`);
  }

  const failure = await shell.openPath(normalizedTarget);
  if (failure) {
    throw new Error(failure);
  }
  return normalizedTarget;
}

/**
 * 界面上的「安装插件」按钮：给已经装好 dsh 的用户按清单补装 / 升级插件。
 * 不重装 dsh、也不改模型配置；清单里的单个插件装不上不影响其它插件，结果汇总后交给界面展示。
 */
export async function installDeepseekHarnessPlugins(): Promise<DshPluginInstallSummary> {
  // dsh 的插件是 profile 级的 pnpm 依赖，走 pnpm 装，所以先确保源是国内镜像
  setNpmRegistryTaobaoGlobal();
  logger.log(
    `[${DS_LABEL}] 开始按清单安装 dsh 插件（清单：${dshPluginIndexPath()}）...`,
  );
  // 桌面版开着时先关掉再装，装完自动重新打开（桌面版会独占 profile 文件锁）
  return runDshPluginInstall();
}

export default async function init(ipcMain: IpcMain) {
  // 桌面版是独立应用：启动器退出时不结束它
  ipcHandle(ipcMain, queryDeepseekHarnessServiceHandle, async (_event) =>
    queryDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, installDeepseekHarnessServiceHandle, async (_event) =>
    installDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, removeDeepseekHarnessServiceHandle, async (_event) =>
    removeDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, syncWorkbuddyModelsToDshHandle, async (_event) =>
    syncWorkbuddyModelsToDsh(),
  );
  ipcHandle(
    ipcMain,
    openDeepseekHarnessBackupDirHandle,
    async (_event, dir?: string) => openDeepseekHarnessBackupDir(dir),
  );
  ipcHandle(ipcMain, installDshPluginsHandle, async (_event) =>
    installDeepseekHarnessPlugins(),
  );
}
