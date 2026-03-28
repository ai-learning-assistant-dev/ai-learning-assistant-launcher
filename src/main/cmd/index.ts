import { dialog, IpcMain } from 'electron';
import { ActionName, channel, ServiceName } from './type-info';
import { appPath, Exec } from '../exec';
import { isMac, isWindows, replaceVarInPath } from '../exec/util';
import {
  getObsidianConfig,
  setVaultDefaultOpen,
  getObsidianVaultConfig,
} from '../configs';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import path from 'node:path';
import { statSync } from 'node:fs';
import {
  ensurePodmanWorks,
  getPodmanCli,
  resetPodman,
  stopPodman,
  isPodmanInstall,
  isPodmanInit,
  getPodmanInfo,
} from '../podman-desktop/ensure-podman-works';
import { RunResult } from '@podman-desktop/api';
import { podMachineName } from '../podman-desktop/type-info';
import { isVTReady, isWSLInstall, wslVersion } from './is-wsl-install';
import { loggerFactory } from '../terminal-log';
import { WEBTORRENT_CONFIG } from '../webtorrent-config';

/**
 * 判断错误是否为 EBUSY 错误（文件被占用）
 */
function isEBUSYError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('EBUSY');
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message).includes('EBUSY');
  }
  return false;
}

/**
 * 获取错误信息
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

interface RetryExecuteOptions {
  /** 执行的程序路径 */
  exePath: string;
  /** 执行参数 */
  args: string[];
  /** 日志前缀，用于区分不同的安装程序 */
  logPrefix: string;
}

/**
 * 带重试机制执行安装程序
 * 处理 EBUSY 错误（文件被占用）的情况
 */
async function executeWithRetry(
  options: RetryExecuteOptions,
): Promise<boolean> {
  const { exePath, args, logPrefix } = options;
  const maxRetries = WEBTORRENT_CONFIG.MAX_RETRIES;

  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      // 每次重试前等待更长时间，让文件句柄有充足时间释放
      const waitTime =
        retry === 0
          ? WEBTORRENT_CONFIG.RETRY_BASE_WAIT
          : WEBTORRENT_CONFIG.RETRY_BASE_WAIT +
            retry * WEBTORRENT_CONFIG.RETRY_INCREMENT;
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      console.debug(
        `[${logPrefix}] 尝试执行安装程序 (${retry + 1}/${maxRetries})，等待了 ${waitTime}ms`,
      );
      const result = await commandLine.exec(exePath, args);
      console.debug(`[${logPrefix}] 安装程序执行成功:`, result);
      return true;
    } catch (e) {
      if (isEBUSYError(e) && retry < maxRetries - 1) {
        console.warn(
          `[${logPrefix}] 执行安装程序失败 (EBUSY)，重试 ${retry + 1}/${maxRetries}...`,
        );
      } else if (isEBUSYError(e)) {
        // 所有重试都失败了，尝试最后一次长等待
        console.warn(`[${logPrefix}] 所有重试都失败，尝试最后一次长等待...`);
        await new Promise((resolve) =>
          setTimeout(resolve, WEBTORRENT_CONFIG.FINAL_RETRY_WAIT),
        );
        try {
          const result = await commandLine.exec(exePath, args);
          console.debug(`[${logPrefix}] 最后一次尝试成功:`, result);
          return true;
        } catch (finalError) {
          console.error(`[${logPrefix}] 最后一次尝试也失败了:`, finalError);
          throw finalError;
        }
      } else {
        throw e;
      }
    }
  }
  return false;
}

interface P2PInstallOptions {
  /** DLC 索引中的 key */
  dlcKey:
    | 'OBSIDIAN_SETUP_EXE'
    | 'LM_STUDIO_SETUP_EXE'
    | 'PDF_TAR'
    | 'VOICE_TAR'
    | 'TRAINING_TAR'
    | 'TRAINING_VOICE_TAR'
    | 'TRAINING_COURSE'
    | 'LMSTUDIO_WINDOWS'
    | 'AI_LEARNING_ASSISTANT_LAUNCHER'
    | 'TEST_FILE';
  /** 安装程序参数 */
  installerArgs: string[];
  /** 日志前缀 */
  logPrefix: string;
  /** 降级时使用的本地安装包相对路径 */
  fallbackInstallerPath: string;
}

/**
 * 通用的 P2P 下载安装逻辑
 * 优先使用 P2P 下载的安装包，失败时降级到本地安装包
 */
async function installFromP2POrFallback(
  options: P2PInstallOptions,
): Promise<boolean> {
  const { dlcKey, installerArgs, logPrefix, fallbackInstallerPath } = options;

  try {
    // 首先检查是否有P2P下载的文件
    const { getDLCFromDLCIndex, destroyWebtorrentForInstall } = await import(
      '../dlc'
    );
    const dlcInfo = getDLCFromDLCIndex(dlcKey);

    if (dlcInfo) {
      const latestVersion = Object.keys(dlcInfo.versions).sort().pop();
      if (latestVersion) {
        const versionInfo = dlcInfo.versions[latestVersion];

        // 完全销毁 torrent 以释放文件句柄，避免 EBUSY 错误
        if (versionInfo.magnet) {
          try {
            console.debug(`[${logPrefix}] 开始销毁种子以释放文件句柄...`);
            await destroyWebtorrentForInstall(versionInfo.magnet);
            // 等待额外的时间确保文件句柄完全释放
            await new Promise((resolve) =>
              setTimeout(resolve, WEBTORRENT_CONFIG.TORRENT_DESTROY_WAIT),
            );
            console.debug(`[${logPrefix}] 种子已销毁，等待完成`);
          } catch (e) {
            console.warn(`[${logPrefix}] 销毁torrent失败:`, e);
          }
        }

        const downloadPath = path.join(
          appPath,
          'external-resources',
          'dlc',
          dlcKey,
          latestVersion,
        );

        const fs = await import('fs');
        if (fs.existsSync(downloadPath)) {
          const files = fs.readdirSync(downloadPath);
          const exeFile = files.find((f: string) => f.endsWith('.exe'));

          if (exeFile) {
            const exePath = path.join(downloadPath, exeFile);
            return await executeWithRetry({
              exePath,
              args: installerArgs,
              logPrefix,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`[${logPrefix}] 尝试使用P2P下载包失败，使用默认方式:`, error);
  }

  // 降级到原有的本地安装包方式
  const result = await commandLine.exec(
    path.join(
      appPath,
      'external-resources',
      'ai-assistant-backend',
      fallbackInstallerPath,
    ),
    installerArgs,
  );
  console.debug(`[${logPrefix}] 本地安装包执行结果:`, result);
  return true;
}

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
            let vaultName = null;
            // 获取仓库路径
            if (vaultId) {
              const vaults = getObsidianVaultConfig();
              const vault = vaults.find((v) => v.id === vaultId);
              if (vault) {
                // 获取路径中的最后一个文件夹名称
                vaultName = path.basename(vault.path);
              }
            }
            try {
              obsidianPath = replaceVarInPath(obsidianPath);
              // 如果有仓库路径，则传递给Obsidian作为参数
              const args = vaultName
                ? [`obsidian://open/?vault=${encodeURIComponent(vaultName)}`]
                : [];
              const result = commandLine.exec(obsidianPath, args, {});
              // const result = commandLine.exec(obsidianPath, [], {});
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
            let result: boolean;
            try {
              result = await installWSL();
            } catch (e) {
              console.error(e);
              event.reply(channel, MESSAGE_TYPE.ERROR, e && e.message);
              return;
            }
            const version = await wslVersion();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, {
                version,
                installed: result,
              }),
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
          } else if (serviceName === 'lm-studio') {
            try {
              const result = await installLMStudio();
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
            const vTReady = await isVTReady();
            const version = await wslVersion();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, {
                version,
                vTReady,
                installed: await isWSLInstall(),
              }),
            );
          } else if (serviceName === 'obsidianApp') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, await isObsidianInstall()),
            );
          } else if (serviceName === 'lm-studio') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, await isLMStudioInstall()),
            );
          } else if (serviceName === 'podman') {
            try {
              const podmanInstalled = await isPodmanInstall();
              const podmanInited = await isPodmanInit();
              const podmanInfo = await getPodmanInfo();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  podmanInfo,
                  installed: podmanInstalled && podmanInited,
                }),
              );
            } catch (e) {
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  installed: false,
                }),
              );
            }
          } else {
            const result = await commandLine.exec('echo %cd%');
            event.reply(channel, MESSAGE_TYPE.INFO, '成功查询');
          }
        } else if (action === 'move') {
          const dialogResult = await dialog.showOpenDialog({
            title: '请选择服务的安装位置',
            properties: ['openDirectory', 'showHiddenFiles'],
          });
          const path = dialogResult.filePaths[0];
          if (!path || path === '') {
            event.reply(channel, MESSAGE_TYPE.ERROR, '未选择正确的安装位置');
            return;
          }
          const specialChars = /[\s<>"|?*/\0]/;
          if (specialChars.test(path)) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              `您选择的路径是${path}，路径中包含空格等特殊字符，请删除特殊字符后重试`,
            );
            return;
          }
          try {
            await ensurePodmanWorks(event, channel);
            const result = await movePodman(path);
            if (result.success) {
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, true),
              );
              event.reply(channel, MESSAGE_TYPE.INFO, '成功修改安装位置');
            } else {
              event.reply(channel, MESSAGE_TYPE.ERROR, result.errorMessage);
            }
          } catch (e) {
            console.error(e);
          }
        } else if (action === 'update') {
          if (serviceName === 'WSL') {
            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              '预计需要10分钟，请耐心等待',
            );
            let result: boolean;
            try {
              result = await installWSL();
            } catch (e) {
              console.error(e);
              event.reply(channel, MESSAGE_TYPE.ERROR, e && e.message);
              return;
            }
            const version = await wslVersion();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, {
                version,
                installed: result,
              }),
            );
          } else {
            const result = await commandLine.exec('echo %cd%');
            event.reply(channel, MESSAGE_TYPE.INFO, '成功更新');
          }
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
  // WSL 安装需要windows update服务正常
  try {
    const outputStartWindowsUpdate = await commandLine.exec('net', [
      'start',
      'wuauserv',
    ]);
    console.debug('check windows update', outputStartWindowsUpdate);
  } catch (e) {
    console.error(e);
    if (e && e.message && e.message.indexOf('1058') >= 0) {
      throw new Error(
        '安装WSL失败，因为Windows系统更新未打开。请打开系统更新后重试。',
      );
    }
  }

  try {
    const outputWSLmsi = await commandLine.exec(
      path.join(
        appPath,
        'external-resources',
        'ai-assistant-backend',
        'install_wsl.msi',
      ),
      [],
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
  return installFromP2POrFallback({
    dlcKey: 'OBSIDIAN_SETUP_EXE',
    installerArgs: ['/s'],
    logPrefix: 'Obsidian',
    fallbackInstallerPath: 'install_obsidian.exe',
  });
}

export async function isObsidianInstall() {
  let obsidianPath = getObsidianConfig().obsidianApp.bin;

  try {
    obsidianPath = replaceVarInPath(obsidianPath);
    console.debug('getObsidianConfig', obsidianPath);
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

export async function installLMStudio() {
  return installFromP2POrFallback({
    dlcKey: 'LM_STUDIO_SETUP_EXE',
    installerArgs: [],
    logPrefix: 'LM Studio',
    fallbackInstallerPath: 'install_lm_studio.exe',
  });
}

export async function isLMStudioInstall() {
  try {
    const result = await Promise.race([
      new Promise<RunResult>((resolve, reject) =>
        setTimeout(
          () => reject('isLMStudioInstall命令超时'),
          WEBTORRENT_CONFIG.LM_STUDIO_CHECK_TIMEOUT,
        ),
      ),
      // 如果用户安装lmstudio然后又卸载了lmstudio，那么这个命令会一直卡着，也不报错，所以要用一个超时promise与它竞赛
      commandLine.exec('lms', ['ls']),
    ]);
    console.debug('isLMStudioInstall', result);
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}

export async function movePodman(path: string) {
  let success = false;
  let errorMessage = '修改失败';
  if (!path || path === '') {
    errorMessage = '未选择正确的安装位置';
    return { success: false, errorMessage };
  }
  try {
    await stopPodman();
  } catch (e) {
    console.warn(e);
  }
  try {
    const output1 = await commandLine.exec(
      'wsl.exe',
      ['--shutdown', podMachineName],
      {
        encoding: 'utf16le',
        shell: true,
      },
    );
    console.debug('movePodman', output1);
    const output2 = await commandLine.exec(
      'wsl.exe',
      ['--manage', podMachineName, '--move', path],
      {
        encoding: 'utf16le',
        shell: true,
        logger: loggerFactory('podman'),
      },
    );
    console.debug('movePodman', output2);
    const output3 = await commandLine.exec(
      getPodmanCli(),
      ['machine', 'start'],
      {
        shell: true,
      },
    );
    console.debug('movePodman', output3);
    success = true;
  } catch (e) {
    console.warn('movePodman', e);
    if (
      e &&
      e.stdout &&
      e.stdout.indexOf('Wsl/Service/MoveDistro/0' + 'x80070070') >= 0
    ) {
      errorMessage = '磁盘空间不足';
    } else if (e && e.message.indexOf('exitCode: 4294967295') >= 0) {
      errorMessage = '修改失败，可能是WSL版本太低，请尝试升级WSL';
    }
    success = false;
  }

  return { success, errorMessage };
}
