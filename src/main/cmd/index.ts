import { IpcMain } from 'electron';
import { ActionName, channel, ServiceName } from './type-info';
import { Exec } from '../exec';
import { isMac, isWindows } from '../exec/util';
import { getObsidianConfig } from '../configs'
import { Channels, MESSAGE_TYPE, MessageData } from '../ipc-data-type';

const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      console.debug(
        `cmd action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      if (isWindows()) {
        if (action === 'start') {
          if(serviceName === 'obsidianApp'){
            // Obsidian app specific command
            console.debug('obsidian app start');
            const obsidianPath = getObsidianConfig().obsidianApp.bin;
            try{
              const result = await commandLine.exec(obsidianPath);
              event.reply(channel, MESSAGE_TYPE.INFO, '成功启动obsidian');
            }catch(e){
              console.log('e',e)
              
              event.reply(channel, MESSAGE_TYPE.ERROR, '启动obsidian失败，请检查obsidian路径设置');
            }
          }else{
            const result = await commandLine.exec('echo %cd%');
            console.debug('cmd', result);
            event.reply(channel, MESSAGE_TYPE.INFO, '成功启动');
          }
        } else if (action === 'stop') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功停止');
        } else if (action === 'remove') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功删除');
        } else if (action === 'install') {
          if (serviceName === 'WSL') {
            const result = await installWSL();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, result),
            );
          } else {
            const result = await commandLine.exec('echo %cd%');
            event.reply(channel, MESSAGE_TYPE.INFO, '安装成功');
          }
        } else if (action === 'query') {
          if (serviceName === 'WSL') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, await isWSLInstall()),
            );
          } else{
            const result = await commandLine.exec('echo %cd%');
            event.reply(channel, MESSAGE_TYPE.INFO, '成功查询');
          }
        } else if (action === 'update') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功更新');
        } else {
          event.reply(channel, MESSAGE_TYPE.ERROR, '现在还没有这个功能');
        }
      } else if (isMac()) {
        if (action === 'start') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功启动');
        } else if (action === 'stop') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功停止');
        } else if (action === 'remove') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功删除');
        } else if (action === 'install') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '安装成功');
        } else if (action === 'query') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功查询');
        } else if (action === 'update') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功更新');
        } else {
          event.reply(channel, MESSAGE_TYPE.ERROR, '现在还没有这个功能');
        }
      } else {
        event.reply(channel, MESSAGE_TYPE.ERROR, '现在还不支持这个平台');
      }
    },
  );
}

export async function installWSL() {
  try {
    const result1 = await commandLine.exec(
      'dism.exe',
      [
        '/online',
        '/enable-feature',
        '/featurename:Microsoft-Windows-Subsystem-Linux',
        '/all',
        '/norestart',
      ],
      { isAdmin: true },
    );
    console.debug('installWSL', result1);
  } catch (e) {
    console.warn(e);
  }

  try {
    const result2 = await commandLine.exec(
      'dism.exe',
      [
        '/online',
        '/enable-feature',
        '/featurename:VirtualMachinePlatform',
        '/all',
        '/norestart',
      ],
      { isAdmin: true },
    );
  } catch (e) {
    console.warn(e);
  }
  return true;
}

async function isWSLInstall() {
  try {
    const output = await commandLine.exec('wsl', ['--status']);
    console.debug('isWSLInstall', output);
    if (
      output.stdout.indexOf('Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED') >= 0
    ) {
      return false;
    }
  } catch (e) {
    console.warn(e);
    return false;
  }
  return true;
}