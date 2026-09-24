import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'deepseek-harness-service';

export const queryDeepseekHarnessServiceHandle = `${channel}query`;

export const installDeepseekHarnessServiceHandle = `${channel}install`;

export const removeDeepseekHarnessServiceHandle = `${channel}remove`;

export const runDeepseekHarnessServiceHandle = `${channel}run`;

export const stopDeepseekHarnessServiceHandle = `${channel}stop`;

/** 打开 DeepSeek Harness dashboard 界面窗口 */
export const openDeepseekHarnessWindowHandle = `${channel}open-window`;

/** 复制 DeepSeek Harness dashboard 页面链接到剪贴板 */
export const copyDeepseekHarnessDashboardUrlHandle = `${channel}copy-dashboard-url`;

/**
 * DeepSeek Harness Web 界面的候选端口（按探测顺序）。
 * 3080 是 dsh web 的默认端口：机器上已经有 dsh 实例在跑时优先复用它，
 * 只有所有候选端口都没有实例时才由本模块拉起新的实例。
 */
export const DEEPSEEK_HARNESS_PORTS = [3080, 3081, 3082];

/** DeepSeek Harness dashboard 网页地址（固定走本机回环地址） */
export const deepseekHarnessDashboardHost = '127.0.0.1';

export function deepseekHarnessDashboardUrl(port: number): string {
  return `http://${deepseekHarnessDashboardHost}:${port}/`;
}

/** dsh 全局安装的 npm 包名 */
export const DEEPSEEK_HARNESS_NPM_PACKAGE = '@deepseek-ai/dsh';

/**
 * dsh 支持的 Node 版本范围：dsh 的会话持久化会用到 Node 24 才有的
 * zlib zstd API（`zstdCompressSync`），而包本身没有声明 engines 字段，
 * Node 22 及以下只会在运行时抛晦涩的 SyntaxError。
 * @see https://github.com/deepseek-ai/deepseek-harness/discussions/4459
 */
export const DEEPSEEK_HARNESS_NODE_RANGE = '>=24.0.0';

export interface DeepseekHarnessServiceInfo {
  state: 'not_install' | 'installing' | 'installed' | 'uninstalling';
  /** 全局安装的 dsh CLI 版本号 */
  version?: string;
  /** Web 界面是否正在运行（本模块拉起的或机器上已有的实例） */
  running?: boolean;
  /** Web 界面实际监听端口 */
  port?: number;
}
