import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'openclaw-service';

export const queryOpenclawServiceHandle = `${channel}query`;

export const installOpenclawServiceHandle = `${channel}install`;

export const removeOpenclawServiceHandle = `${channel}remove`;

export const runOpenclawServiceHandle = `${channel}run`;

export const stopOpenclawServiceHandle = `${channel}stop`;

/** 打开 openclaw dashboard 界面窗口 */
export const openOpenclawWindowHandle = `${channel}open-window`;

/** 复制 openclaw dashboard 页面链接到剪贴板 */
export const copyOpenclawDashboardUrlHandle = `${channel}copy-dashboard-url`;

/** openclaw 网关默认端口 */
export const OPENCLAW_GATEWAY_PORT = 18789;

/** openclaw dashboard 网页地址 */
export const openclawDashboardUrl = `http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}/`;

export interface OpenclawServiceInfo {
  state: 'not_install' | 'installing' | 'installed' | 'uninstalling';
  /** 安装版本号 */
  version?: string;
  /** 网关是否正在后台运行 */
  running?: boolean;
}
