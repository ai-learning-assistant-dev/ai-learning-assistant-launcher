/**
 * 「把本项目的大模型配置同步进 DeepSeek Harness」的公共入口。
 *
 * 安装 dsh 之后的初始化，和模型配置页里的「同步 API key」按钮，都走这里，
 * 保证两条路径的换算规则、写入方式、日志文案完全一致。
 *
 * 本文件刻意不 import `../configs`：调用方把模型列表传进来即可，
 * 免得 configs 与 deepseek-harness-service 互相 import 形成环。
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { loggerFactory } from '../terminal-log';
import {
  hasSettingsToSync,
  planDshModelSync,
  type SyncableModel,
} from './model-sync-plan';
import {
  planWorkbuddyModelSync,
  readWorkbuddyModels,
  resolveWorkbuddyModelsPath,
} from './workbuddy-model-sync';
import {
  backupDshConfigFiles,
  type DshConfigBackupResult,
} from './dsh-config-backup';
import {
  applyModelSyncViaDshPackages,
  type CommandRunner,
  type SyncLogger,
} from './dsh-config-providers';

/** 本模块就是「同步进 dsh」的对外入口，这几个类型一并转出，调用方只 import 这里 */
export type { CommandRunner, SyncLogger } from './dsh-config-providers';
export type { DshConfigBackupResult } from './dsh-config-backup';
export { resolveWorkbuddyModelsPath } from './workbuddy-model-sync';

const DS_LABEL = 'DEEPSEEK_HARNESS';

// ===== dsh 安装目录与配置文件 =====

/** dsh 的数据目录：$DSH_HOME，未设置时用 ~/.dsh */
export function resolveDshHome(): string {
  const fromEnv = (process.env.DSH_HOME || '').trim();
  return fromEnv || path.join(homedir(), '.dsh');
}

/** dsh 的用户设置文档（模型路由写在这里） */
export function dshSettingsPath(): string {
  return path.join(resolveDshHome(), 'settings.yaml');
}

/** dsh 的凭据文件（API key 写在这里） */
export function dshCredentialsPath(): string {
  return path.join(resolveDshHome(), '.credentials.yaml');
}

/** dsh 配置的备份根目录（每次同步前把上面两个文件整份复制到这里） */
export function dshBackupRoot(): string {
  return path.join(resolveDshHome(), 'backups');
}

/** 从 WorkBuddy 同步模型配置的默认说明（写进备份 manifest） */
const WORKBUDDY_SYNC_LABEL = '同步 WorkBuddy 模型配置';

/** 同步用的日志出口：同时写 console（落盘 launcher.log）和界面命令行日志 */
export function createDshSyncLogger(): SyncLogger {
  const target = loggerFactory(DS_LABEL);
  const withPrefix = (message: string): string => `[${DS_LABEL}] ${message}`;
  return {
    log(message: string): void {
      console.log(withPrefix(message));
      target.log(withPrefix(message));
    },
    warn(message: string, cause?: unknown): void {
      console.warn(withPrefix(message), cause);
      target.warn(
        cause === undefined
          ? withPrefix(message)
          : `${withPrefix(message)}（${String(cause)}）`,
      );
    },
  };
}

/**
 * 把一份大模型配置同步进 dsh：写 `$DSH_HOME/settings.yaml`（模型路由）与
 * `$DSH_HOME/.credentials.yaml`（API key），全部通过 dsh 自带的配置包完成。
 *
 * 换算规则见 model-sync-plan.ts：密钥为空 / 全空白不写凭据、路由也不声明 `apiKeyEnv`；
 * DeepSeek 提供方走内置路由 `deepseek-official`，其余走 `llm-pi-ai` 自定义提供方；
 * DeepSeek 密钥同时写进联网搜索提供方 `web-search-deepseek`（非 DeepSeek 密钥不写）。
 *
 * @returns 写入摘要；`[]` 表示没有可同步的模型（原因已记日志）；
 *          `null` 表示 dsh 自带的配置包不可用（调用方应提示用户去 dsh 界面里手动配置）
 */
export async function syncModelsIntoDshHarness(options: {
  models: SyncableModel[];
  run: CommandRunner;
  logger: SyncLogger;
}): Promise<string[] | null> {
  const { models: rawModels, run, logger } = options;

  // 嵌入模型 / 缺名称或地址的模型不参与 dsh 的 LLM 路由
  const models = rawModels.filter(
    (model) => !model.isEmbeddingModel && !!model.name && !!model.baseUrl,
  );
  if (models.length === 0) {
    logger.warn('未配置可用的大模型，跳过模型配置同步');
    return [];
  }

  const plan = planDshModelSync(models);
  for (const warning of plan.warnings) {
    logger.warn(warning);
  }
  for (const name of plan.keylessModels) {
    logger.warn(
      `模型 ${name} 的 API key 为空，已整条跳过：不会写入 dsh 的路由与凭据（在本页填好 API key 后重新同步即可）`,
    );
  }

  if (!hasSettingsToSync(plan) && Object.keys(plan.credentials).length === 0) {
    logger.warn('没有可写入的模型路由，已跳过配置同步');
    return [];
  }

  return applyModelSyncViaDshPackages({
    plan,
    settingsPath: dshSettingsPath(),
    credentialsPath: dshCredentialsPath(),
    run,
    logger,
  });
}

/** {@link syncWorkbuddyModelsIntoDshHarness} 的结果 */
export interface WorkbuddyModelSyncOutcome {
  /** 写入摘要（每条一项，可直接拼给用户看） */
  summary: string[];
  /** 最终写进 dsh 的模型数 / 生成的路由数 */
  syncedModels: number;
  routeCount: number;
  /** 备份结果 */
  backup: DshConfigBackupResult;
  /** 涉及的文件路径，便于界面展示 */
  paths: {
    workbuddyModels: string;
    settings: string;
    credentials: string;
    backupRoot: string;
  };
  /** 没有被同步的模型（没有密钥 / 缺地址等），用于界面提示 */
  notices: Array<{ name: string; reason: string }>;
  /** 配置冲突等非致命提示 */
  warnings: string[];
}

/**
 * 把 **WorkBuddy 的自定义模型配置**同步进 dsh。
 *
 * 与 {@link syncModelsIntoDshHarness}（同步本项目自己的配置）的区别只有数据来源：
 * 两者最后都走 dsh 自带的配置包写入，写入语义（叶子级 diff、保留注释、凭据文件锁）完全一致。
 *
 * 顺序刻意是「换算 → 备份 → 写入」：备份发生在任何写入动作之前，
 * 且只有确实有内容要写时才备份，避免空操作也留下备份目录。
 *
 * @returns 写入结果；`null` 表示 dsh 自带的配置包不可用（调用方应提示用户去 dsh 界面里手动配置）
 * @throws 读不到 / 读不懂 WorkBuddy 配置、或没有任何可同步的模型时抛出可直接展示给用户的错误
 */
export async function syncWorkbuddyModelsIntoDshHarness(options: {
  run: CommandRunner;
  logger: SyncLogger;
  /** 覆盖 WorkBuddy 配置路径（默认 `%USERPROFILE%\.workbuddy\models.json`） */
  workbuddyModelsPath?: string;
}): Promise<WorkbuddyModelSyncOutcome | null> {
  const { run, logger } = options;
  const workbuddyModelsPath =
    options.workbuddyModelsPath ?? resolveWorkbuddyModelsPath();

  // 1) 换算（读文件 + 纯计算）：换算出错时直接抛出，不会有任何写入与备份
  const models = readWorkbuddyModels(workbuddyModelsPath);
  logger.log(
    `[${DS_LABEL}] 读取 WorkBuddy 模型配置：${workbuddyModelsPath}（${models.length} 条）`,
  );

  const { plan, total, synced, notices } = planWorkbuddyModelSync(models);
  for (const notice of notices) {
    logger.warn(
      `[${DS_LABEL}] 模型 ${notice.name} 未同步到 dsh：${notice.reason}`,
    );
  }
  for (const warning of plan.warnings) {
    logger.warn(`[${DS_LABEL}] ${warning}`);
  }

  const routeCount = Object.keys(plan.piAiProviders).length;
  if (routeCount === 0 || !hasSettingsToSync(plan)) {
    throw new Error(
      `WorkBuddy 的 ${total} 个模型里没有可同步的条目（${
        notices[0]?.reason ?? '缺少模型 id / API 地址 / API key'
      }）。请先在 WorkBuddy 里配置好再试`,
    );
  }

  // 2) 备份：写入前把 dsh 的配置整份复制到 $DSH_HOME/backups/<时间戳>/
  const settingsPath = dshSettingsPath();
  const credentialsPath = dshCredentialsPath();
  const backup = backupDshConfigFiles({
    files: [settingsPath, credentialsPath],
    backupRoot: dshBackupRoot(),
    label: WORKBUDDY_SYNC_LABEL,
  });
  if (backup.dir) {
    logger.log(
      `[${DS_LABEL}] ${backup.reused ? '沿用已有备份' : '已备份'} dsh 配置：${
        backup.dir
      }（${backup.files.join('、')}）`,
    );
  } else {
    logger.log(
      `[${DS_LABEL}] dsh 还没有配置文件，本次无需备份（${settingsPath}）`,
    );
  }

  // 3) 写入：交给 dsh 自带的配置包，写入失败不会动用户的文件
  const summary = await applyModelSyncViaDshPackages({
    plan,
    settingsPath,
    credentialsPath,
    run,
    logger,
  });
  if (summary === null) {
    return null;
  }

  return {
    summary,
    syncedModels: synced,
    routeCount,
    backup,
    paths: {
      workbuddyModels: workbuddyModelsPath,
      settings: settingsPath,
      credentials: credentialsPath,
      backupRoot: dshBackupRoot(),
    },
    notices,
    warnings: plan.warnings,
  };
}
