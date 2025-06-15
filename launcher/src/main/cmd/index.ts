import { IpcMain } from 'electron';
import { ActionName, ServiceName } from './type-info';
import { Exec } from '../exec';
import { Channels } from '../preload';
import { isMac, isWindows } from '../exec/util';

const channel: Channels = 'cmd';

const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      if (isWindows()) {
        if (action === 'start') {
          const result = await commandLine.exec('echo %cd%');
          console.debug('cmd', result);
          event.reply(channel, 'info', '成功启动');
        } else if (action === 'stop') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, 'info', '成功停止');
        } else if (action === 'remove') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, 'info', '成功删除');
        } else if (action === 'install') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, 'info', '安装成功');
        } else if (action === 'query') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, 'info', '成功查询');
        } else if (action === 'update') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, 'info', '成功更新');
        } else {
          event.reply(channel, 'error', '现在还没有这个功能');
        }
      } else if (isMac()) {
        if (action === 'start') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, 'info', '成功启动');
        } else if (action === 'stop') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, 'info', '成功停止');
        } else if (action === 'remove') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, 'info', '成功删除');
        } else if (action === 'install') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, 'info', '安装成功');
        } else if (action === 'query') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, 'info', '成功查询');
        } else if (action === 'update') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, 'info', '成功更新');
        } else {
          event.reply(channel, 'error', '现在还没有这个功能');
        }
      } else {
        event.reply(channel, 'error', '现在还不支持这个平台');
      }
    },
  );
}
