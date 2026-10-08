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
  applyModelSyncViaDshPackages,
  type CommandRunner,
  type SyncLogger,
} from './dsh-config-providers';

/** 本模块就是「同步进 dsh」的对外入口，这几个类型一并转出，调用方只 import 这里 */
export type { CommandRunner, SyncLogger } from './dsh-config-providers';

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
