import type { Channels } from '../ipc-data-type';

export type ServiceName = 'browser';
export type ActionName = 'open';

export const channel: Channels = 'open-external-url';