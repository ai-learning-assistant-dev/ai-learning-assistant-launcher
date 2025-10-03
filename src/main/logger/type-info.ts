import type { Channels } from '../ipc-data-type';

export type ServiceName = 'LOG';
export type ActionName = 'export';

export const channel: Channels = 'logger';
