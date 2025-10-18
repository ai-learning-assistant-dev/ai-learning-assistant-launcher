import { IpcMain } from 'electron';
import { app, shell } from 'electron';
import path from 'path';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { ActionName, ServiceName, logChannel } from './type-info';

export default async function init(ipcMain: IpcMain) {
  // 统一使用 configs 通道处理日志相关操作
  ipcMain.on('configs', async (
    event,
    action: ActionName,
    serviceName: ServiceName,
    extraData?: any
  ) => {
    if (serviceName === 'log') {
      if (action === 'openLogsDirectory') {
        try {
          const logPath = getLogDirectory();
          const result = await shell.openPath(logPath);
          
          if (result) {
            event.reply('configs', MESSAGE_TYPE.ERROR, result);
          } else {
            event.reply('configs', MESSAGE_TYPE.INFO, '日志目录已打开');
          }
        } catch (error) {
          event.reply('configs', MESSAGE_TYPE.ERROR, error.message);
        }
      }
    }
  });
}

function getLogDirectory(): string {
  // 获取日志目录，这里假设日志存储在应用数据目录下的logs文件夹
  return app.getAppPath();
}