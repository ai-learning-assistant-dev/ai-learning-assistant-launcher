import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'deepseek-harness-service';

export const queryDeepseekHarnessServiceHandle = `${channel}query`;

export const installDeepseekHarnessServiceHandle = `${channel}install`;

export const removeDeepseekHarnessServiceHandle = `${channel}remove`;

/** 把 WorkBuddy 的模型配置同步进 DeepSeek Harness（写入前自动备份 dsh 配置） */
export const syncWorkbuddyModelsToDshHandle = `${channel}sync-workbuddy-models`;

/** 在系统文件管理器里打开 dsh 配置的备份目录 */
export const openDeepseekHarnessBackupDirHandle = `${channel}open-backup-dir`;

/**
 * 按插件清单给「已经装好 dsh」的用户补装 / 升级插件。
 * 与安装流程里那一步是同一套实现，只是不重新装 dsh、也不改模型配置。
 */
export const installDshPluginsHandle = `${channel}install-plugins`;

export interface DeepseekHarnessServiceInfo {
  state: 'not_install' | 'installing' | 'installed' | 'uninstalling';
  /** 已安装的 DeepSeek Harness 桌面版版本号 */
  version?: string;
}

/** 一次「从 WorkBuddy 同步模型配置到 dsh」的结果，直接给界面展示 */
export interface WorkbuddyModelSyncResult {
  /** 用了几个 WorkBuddy 模型、生成了几条 dsh 路由 */
  workbuddyModelCount: number;
  syncedModelCount: number;
  routeCount: number;
  /** 写入摘要（每条一句，界面按行展示） */
  summary: string[];
  /** 备份信息：同步前把 dsh 配置复制到了哪里 */
  backup: {
    /** 备份目录；null 表示 dsh 还没有配置文件，无需备份 */
    dir: string | null;
    files: string[];
    /** true 表示与上一次备份内容相同，复用了已有目录 */
    reused: boolean;
  };
  /** 涉及的文件路径 */
  paths: {
    workbuddyModels: string;
    profilePatch: string;
    credentials: string;
    backupRoot: string;
  };
  /** 没有同步过来的模型及原因 */
  notices: Array<{ name: string; reason: string }>;
  /** 配置冲突等非致命提示 */
  warnings: string[];
}

/**
 * 一次「按清单安装 dsh 插件」的结果，直接给界面展示。
 * 单个插件装不上不会让整次操作失败，失败项都收在 `failed` 里。
 */
export interface DshPluginInstallSummary {
  /** 这次用的清单从哪来：remote 安装前下载的最新一份 / local 回退本地那份 */
  source: 'remote' | 'local';
  /** 清单文件路径（本地那份，远程清单成功时会先覆盖它） */
  indexPath: string;
  /** 清单里一共几条（含 enabled:false 的） */
  total: number;
  /** 这次新装 / 升级的插件（`name@版本`） */
  installed: string[];
  /** 跳过的插件（已是最新 / 本地路径装的 / 清单里 enabled:false） */
  skipped: string[];
  /** 没装上的插件及原因 */
  failed: Array<{ name: string; reason: string }>;
  /** 操作前桌面版是否在运行（运行中被关闭后再装插件，需用户手动重新打开） */
  running: boolean;
}
