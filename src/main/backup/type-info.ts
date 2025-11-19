import { MESSAGE_TYPE } from "../ipc-data-type";

// 定义通道名称
export const logChannel = 'backup';

// 定义动作名称
export type ActionName = 'exportLogs';

// 定义服务名称
export type ServiceName = 'log';

// 定义消息数据结构
export class LogMessageData {
  constructor(
    public action: ActionName,
    public service: ServiceName,
    public data?: any
  ) {}
}

export { MESSAGE_TYPE };