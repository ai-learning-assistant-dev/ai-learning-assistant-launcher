export type Channels =
  | 'ipc-example'
  | 'docker'
  | 'container-logs'
  | 'cmd'
  | 'wsl'
  | 'configs'
  | 'obsidian-plugin'
  | 'lm-studio'
  | 'example' // 测试通道
  | 'workspace'
  | 'terminal-log'
  | 'pdf-convert'
  | 'pdf-convert-completed'
  | 'pdf-config';

export enum MESSAGE_TYPE {
  /** 阻断性错误，会把转圈中的按钮变成不转圈 */
  ERROR = 'error',
  /** 结果信息，会把转圈中的按钮变成不转圈 */
  INFO = 'info',
  /** 提示信息，不会把转圈中的按钮变成不转圈 */
  WARNING = 'warning',
  /** 传输数据，不会把转圈中的按钮变成不转圈 */
  DATA = 'data',
  /** 进度信息，不会把转圈中的按钮变成不转圈 */
  PROGRESS = 'progress',
  /** 非阻断性错误，不会把转圈中的按钮变成不转圈 */
  PROGRESS_ERROR = 'progress_error',
}

import {
  ActionName as ActionNamePodman,
  ServiceName as ServiceNamePodman,
} from './podman-desktop/type-info';
import {
  ActionName as ActionNameCmd,
  ServiceName as ServiceNameCmd,
} from './cmd/type-info';
import {
  ActionName as ActionNameConfigs,
  ServiceName as ServiceNameConfigs,
} from './configs/type-info';
import {
  ActionName as ActionNameObsidianPlugin,
  ServiceName as ServiceNameObsidianPlugin,
} from './obsidian-plugin/type-info';
import {
  ActionName as ActionNameLMStudio,
  ServiceName as ServiceNameLMStudio,
} from './lm-studio/type-info';
import {
  ActionName as ActionNameExampleMain,
  ServiceName as ServiceNameExampleMain,
} from './example-main/type-info';
import {
  ActionName as ActionNameWorkspace,
  ServiceName as ServiceNameWorkspace,
} from './workspace/type-info';
import {
  ActionName as ActionNamePdfConvert,
  ServiceName as ServiceNamePdfConvert,
} from './pdf-convert/type-info';
import {
  ActionName as LogActionName,
  ServiceName as LogServiceName,
} from './log-main/type-info';

export type AllAction =
  | ActionNamePodman
  | ActionNameCmd
  | ActionNameConfigs
  | ActionNameObsidianPlugin
  | ActionNamePdfConvert
  | ActionNameLMStudio
  | ActionNameExampleMain
  | ActionNameWorkspace // 添加 workspace 类型
  | LogActionName;

export type AllService =
  | ServiceNamePodman
  | ServiceNameCmd
  | ServiceNameConfigs
  | ServiceNameObsidianPlugin
  | ServiceNamePdfConvert
  | ServiceNameLMStudio
  | ServiceNameExampleMain
  | ServiceNameWorkspace
  | LogServiceName;

export class MessageData<
  A extends AllAction = AllAction,
  S extends AllService = AllService,
  D = any,
> {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    public action: A,
    public service: S,
    public data: D,
  ) {}

  toString() {
    return `${this.action},${this.service},${JSON.stringify(this.data)}`;
  }
}
