import type { Channels } from '../ipc-data-type';

export type ServiceName = 'WSL' | 'podman' | 'obsidianApp' | 'lm-studio';
export type ActionName =
  | 'query'
  | 'install'
  | 'start'
  | 'stop'
  | 'remove'
  | 'update'
  | 'move';

export const channel: Channels = 'cmd';
