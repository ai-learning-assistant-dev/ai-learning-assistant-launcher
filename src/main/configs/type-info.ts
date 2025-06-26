import type { Channels } from '../ipc-data-type';

export type ServiceName = 'obsidianApp' | 'obsidianVault';
export type ActionName =
  | 'query'
  | 'update';

export const channel: Channels = 'configs';
