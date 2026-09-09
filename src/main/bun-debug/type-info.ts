import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'bun-debug';

/** 打开带 bun 环境变量的 cmd 调试窗口 */
export const openBunDebugHandle = `${channel}open`;
