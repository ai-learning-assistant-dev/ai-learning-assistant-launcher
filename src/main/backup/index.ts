import { IpcMain, dialog } from 'electron';
import { app, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { ActionName, ServiceName, logChannel } from './type-info';
import { appPath } from '../exec';

export default async function init(ipcMain: IpcMain) {
  // 使用 backup 通道处理日志导出操作
  ipcMain.on('backup', async (
    event,
    action: ActionName,
    serviceName: ServiceName,
    extraData?: any
  ) => {
    if (serviceName === 'log') {
      if (action === 'exportLogs') {
        try {
          // 显示目录选择对话框
          const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: '选择保存日志文件的目录'
          });
          
          if (result.canceled) {
            event.reply('backup', MESSAGE_TYPE.INFO, '用户取消了操作');
            return;
          }
          
          const selectedPath = result.filePaths[0];
          const logSourcePath = path.join(appPath, 'launcher.log');
          const logDestPath = path.join(selectedPath, 'launcher.log');
          
          // 检查源日志文件是否存在
          if (!fs.existsSync(logSourcePath)) {
            event.reply('backup', MESSAGE_TYPE.ERROR, '日志文件不存在');
            return;
          }
          
          // 复制文件到用户选择的目录
          fs.copyFileSync(logSourcePath, logDestPath);
          
          event.reply('backup', MESSAGE_TYPE.INFO, '日志文件已成功导出到指定目录,文件名：launcher.log');
        } catch (error) {
          event.reply('backup', MESSAGE_TYPE.ERROR, `日志导出失败: ${error.message}`);
        }
      }
    }
  });
}