import type { Channels } from '../ipc-data-type';

export type ServiceName = 'WSL';
export type ActionName =
  | 'query'
  | 'install'
  | 'start'
  | 'stop'
  | 'remove'
  | 'update';

export const channel: Channels = 'cmd';
