export type Channels = 'ipc-example' | 'docker' | 'cmd' | 'wsl';

export enum MESSAGE_TYPE {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  DATA = 'data',
  PROGRESS = 'progress',
  PROGRESS_ERROR = 'progress_success',
}

export class MessageData<A extends string, S extends string, D extends any> {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    public action: A,
    public service: S,
    public data: D,
  ) {}
}
