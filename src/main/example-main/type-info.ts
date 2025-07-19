import type { Channels } from '../ipc-data-type';

export type ServiceName = 'service1' | 'service2' | 'all';
export type ActionName =
  | 'query'
  | 'install'
  | 'start'
  | 'stop'
  | 'remove'
  | 'update';

export const channel: Channels = 'example';

export interface ExampleData {
  name: ServiceName,
  status: 'good' | 'bad'
}