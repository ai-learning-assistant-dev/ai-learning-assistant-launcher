import { dialog, IpcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { appPath } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { ActionName, channel, ServiceName } from './type-info';
import { loggerFactory } from '../terminal-log';

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      try {
        if (action === 'export' && serviceName === 'LOG') {
          const logger = loggerFactory('LOG');
          logger.log('开始导出日志...');
          const srcLog = path.join(appPath, 'launcher.log');
          const result = await dialog.showOpenDialog({
            title: '选择导出日志文件夹',
            properties: ['openDirectory', 'createDirectory'],
          });

          if (result.canceled || !result.filePaths?.length) {
            logger.warn('用户取消了日志导出');
            event.reply(channel, MESSAGE_TYPE.INFO, '已取消导出');
            return;
          }

          const destDir = result.filePaths[0];
          const destPath = path.join(destDir, 'launcher.log');
          logger.log(`复制日志到: ${destPath}`);
          await fs.copyFile(srcLog, destPath);

          event.reply(
            channel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName, { destPath })
          );
          event.reply(channel, MESSAGE_TYPE.INFO, `日志已导出到：${destPath}`);
          logger.log('日志导出完成');
        }
      } catch (error: any) {
        const logger = loggerFactory('LOG');
        logger.error(`日志导出失败: ${error?.message ?? error}`);
        event.reply(channel, MESSAGE_TYPE.ERROR, error?.message ?? '导出失败');
      }
    },
  );
}
