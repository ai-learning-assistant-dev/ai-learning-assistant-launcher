// 将原有内容替换为以下内容
import { MESSAGE_TYPE } from "../ipc-data-type";

// 定义通道名称
export const logChannel = 'configs'; // 使用 configs 通道与其他配置保持一致

// 定义动作名称
export type ActionName = 'openLogsDirectory';

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