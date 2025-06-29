import { IpcMain } from 'electron';
import { ActionName, channel, ServiceName } from './type-info';
import { appPath, Exec } from '../exec';
import { isMac, isWindows } from '../exec/util';
import { getObsidianConfig, setVaultDefaultOpen } from '../configs';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import path from 'node:path';
import { statSync } from 'node:fs';

const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (
      event,
      action: ActionName,
      serviceName: ServiceName,
      vaultId?: string,
    ) => {
      console.debug(
        `cmd action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      if (isWindows()) {
        if (action === 'start') {
          if (serviceName === 'obsidianApp') {
            // Obsidian app specific command
            console.debug('obsidian app start', vaultId);
            if (vaultId) {
              setVaultDefaultOpen(vaultId);
            }
            let obsidianPath = getObsidianConfig().obsidianApp.bin;

            try {
              obsidianPath = obsidianPath.replace(
                '%localappdata%',
                process.env.LOCALAPPDATA,
              );
              const result = commandLine.exec(obsidianPath, [], {});
              event.reply(channel, MESSAGE_TYPE.INFO, '成功启动obsidian');
            } catch (e) {
              console.warn('启动obsidian失败', e);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                '启动obsidian失败，请检查obsidian路径设置',
              );
            }
          } else {
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
          } else if (serviceName === 'obsidianApp') {
            try {
              const result = await installObsidian();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, result),
              );
            } catch (e) {
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, false),
              );
            }
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
          } else if (serviceName === 'obsidianApp') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, await isObsidianInstall()),
            );
          } else {
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
  let success1 = false;
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
    console.warn('installWSL', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010')) {
      console.warn(e);
      success1 = true;
    } else {
      console.error(e);
      success1 = false;
    }
  }

  let success2 = false;
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
    console.warn('installWSL', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010')) {
      console.warn(e);
      success2 = true;
    } else {
      console.error(e);
      success2 = false;
    }
  }
  return success1 && success2;
}

export async function isWSLInstall() {
  let wslWork = false;
  try {
    const output = await commandLine.exec('wsl', ['-l', '-v'], {
      encoding: 'utf16le',
    });
    console.debug('isWSLInstall', output);
    if (
      output.stdout.indexOf('Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED') >= 0
    ) {
      wslWork = false;
    }
    wslWork = true;
  } catch (e) {
    console.warn('isWSLInstall', e);
    wslWork = false;
  }

  return wslWork;
}

async function checkWSLComponent() {
  let virtualMachinePlatformInstalled = true;
  try {
    const output2 = await commandLine.exec(
      'dism.exe',
      ['/online', '/get-featureinfo', '/featurename:VirtualMachinePlatform'],
      {
        isAdmin: true,
      },
    );
    console.debug('isWSLInstall', output2);
    if (output2.stdout.indexOf('已启用') >= 0) {
      virtualMachinePlatformInstalled = true;
    } else {
      virtualMachinePlatformInstalled = false;
    }
  } catch (e) {
    console.warn('isWSLInstall', e);
    virtualMachinePlatformInstalled = false;
  }

  let mWSLInstalled = true;
  try {
    const output2 = await commandLine.exec(
      'dism.exe',
      [
        '/online',
        '/get-featureinfo',
        '/featurename:Microsoft-Windows-Subsystem-Linux',
      ],
      {
        isAdmin: true,
      },
    );
    console.debug('isWSLInstall', output2);
    if (output2.stdout.indexOf('已启用') >= 0) {
      mWSLInstalled = true;
    } else {
      mWSLInstalled = false;
    }
  } catch (e) {
    console.warn('isWSLInstall', e);
    mWSLInstalled = false;
  }

  console.debug(
    'WSL安装情况调试信息',
    'virtualMachinePlatformInstalled',
    virtualMachinePlatformInstalled,
    'mWSLInstalled',
    mWSLInstalled,
  );

  return virtualMachinePlatformInstalled && mWSLInstalled;
}

export async function installObsidian() {
  const result = await commandLine.exec(
    path.join(
      appPath,
      'external-resources',
      'ai-assistant-backend',
      'install_obsidian.exe',
    ),
    ['/s'],
  );
  console.debug(result);
  return true;
}

export async function isObsidianInstall() {
  let obsidianPath = getObsidianConfig().obsidianApp.bin;

  try {
    obsidianPath = obsidianPath.replace(
      '%localappdata%',
      process.env.LOCALAPPDATA,
    );
    const stat = statSync(obsidianPath);
    if (stat.isFile()) {
      return true;
    } else {
      return false;
    }
  } catch (e) {
    console.warn('检查obsidian失败', e);
    return false;
  }
}
