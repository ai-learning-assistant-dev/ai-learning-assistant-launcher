export type Channels = 'ipc-example' | 'docker' | 'cmd' | 'wsl' | 'configs';

export enum MESSAGE_TYPE {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  DATA = 'data',
  PROGRESS = 'progress',
  PROGRESS_ERROR = 'progress_success',
}

import { ActionName as ActionNamePodman, ServiceName as ServiceNamePodman } from './podman-desktop/type-info';
import { ActionName as ActionNameCmd, ServiceName as ServiceNameCmd } from './cmd/type-info';
import { ActionName as ActionNameConfigs, ServiceName as ServiceNameConfigs } from './configs/type-info';
export type AllAction = ActionNamePodman | ActionNameCmd | ActionNameConfigs;
export type AllService = ServiceNamePodman | ServiceNameCmd | ServiceNameConfigs;

export class MessageData<A extends AllAction = AllAction, S extends AllService = AllService,D = any> {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    public action: A,
    public service: S,
    public data: D,
  ) {}
  
  toString(){
    return `${this.action},${this.service},${JSON.stringify(this.data)}`
  }
  
}
