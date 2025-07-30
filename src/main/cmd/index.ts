import { IpcMain } from 'electron';
import { ActionName, channel, ServiceName } from './type-info';
import { appPath, Exec } from '../exec';
import { isMac, isWindows } from '../exec/util';
import { getObsidianConfig, setVaultDefaultOpen } from '../configs';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import path from 'node:path';
import { statSync } from 'node:fs';
import { resetPodman } from '../podman-desktop/ensure-podman-works';

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
          } else if(serviceName === 'lm-studio') {
            await startLMStudioServer();
            event.reply(channel, MESSAGE_TYPE.INFO, '成功启动LM Studio服务');
          } else {
            const result = await commandLine.exec('echo %cd%');
            console.debug('cmd', result);
            event.reply(channel, MESSAGE_TYPE.INFO, '成功启动');
          }
        } else if (action === 'stop') {
           if (serviceName === 'lm-studio') {
            await stopLMStudioServer();
            event.reply(channel, MESSAGE_TYPE.INFO, '成功停止LM Studio服务');
          } else {
            const result = await commandLine.exec('echo %cd%');
          }
          
          event.reply(channel, MESSAGE_TYPE.INFO, '成功停止');
        } else if (action === 'remove') {
          if (serviceName === 'podman') {
            try {
              await resetPodman();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, true),
              );
              event.reply(channel, MESSAGE_TYPE.INFO, '成功删除所有服务和缓存');
            } catch (e) {
              console.error(e);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                '删除所有服务和缓存失败',
              );
            }
          } else {
            event.reply(channel, MESSAGE_TYPE.INFO, '成功删除');
          }
        } else if (action === 'install') {
          if (serviceName === 'WSL') {
            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              '预计需要10分钟，请耐心等待',
            );
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
  try {
    const outputWSLmsi = await commandLine.exec(
      path.join(
        appPath,
        'external-resources',
        'ai-assistant-backend',
        'install_wsl.msi',
      ),
      [],
      { shell: true },
    );

    console.debug('installWSLmsi', outputWSLmsi);
  } catch (e) {
    console.error(e);
    if (e.message.indexOf('exitCode: 1603') >= 0) {
      // 这个错误可能代表安装过了
    } else {
      return false;
    }
  }

  let successM1 = false;
  // 方法一，适用于windows11
  try {
    const resultM1 = await commandLine.exec(
      'wsl.exe',
      ['--install', '--no-distribution'],
      { shell: true, encoding: 'utf16le' },
    );
    console.debug('installWSLM1', resultM1);
    if (
      resultM1.stdout.indexOf('The operation completed successfully') >= 0 ||
      resultM1.stdout.indexOf('请求的操作成功') >= 0 ||
      resultM1.stdout.indexOf('操作成功完成') >= 0
    ) {
      successM1 = true;
    }
  } catch (e) {
    console.warn('installWSLM1', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010') >= 0) {
      console.warn(e);
      successM1 = true;
    } else {
      console.error(e);
      successM1 = false;
    }
  }

  if (successM1) {
    return true;
  }

  //方法二，适用于windows10
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
      { shell: true },
    );
    console.debug('installWSL', result1);
  } catch (e) {
    console.warn('installWSL', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010') >= 0) {
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
      { shell: true },
    );
  } catch (e) {
    console.warn('installWSL', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010') >= 0) {
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
    const output = await commandLine.exec('wsl.exe', ['--status'], {
      encoding: 'utf16le',
      shell: true,
    });
    console.debug('isWSLInstall', output);
    if (
      output.stdout.indexOf('Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED') >= 0 ||
      output.stdout.indexOf('wsl.exe --install') >= 0
    ) {
      wslWork = false;
    } else {
      wslWork = true;
    }
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
        shell: true,
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
        shell: true,
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


export async function startLMStudioServer(){
  try{
    const serverResult = await commandLine.exec(
      'lms',
      ['server', 'start', '--cors'],
      {
        shell: true,
      },
    );
    console.debug('startServer', serverResult);
  }catch(e){
    console.warn(e);
  }
}

export async function stopLMStudioServer(){
  try{
    const serverResult = await commandLine.exec(
      'lms',
      ['server', 'stop'],
      {
        shell: true,
      },
    );
    console.debug('startServer', serverResult);
  }catch(e){
    console.warn(e);
  }
}