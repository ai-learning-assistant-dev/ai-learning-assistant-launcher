import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'launcher-update';

export const checkLauncherUpdateHandle = `${channel}checkUpdate`;

export const downloadLauncherUpdateHandle = `${channel}downloadUpdate`;

export const installLauncherUpdateHandle = `${channel}installUpdate`;
