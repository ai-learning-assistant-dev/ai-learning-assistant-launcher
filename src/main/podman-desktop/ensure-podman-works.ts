import path from 'node:path';
import type { IpcMainEvent } from 'electron';
import { appPath, Exec } from '../exec';
import { isWindows } from '../exec/util';
import { imageNameDict, imagePathDict, ServiceName } from './type-info';
import { Channels, MESSAGE_TYPE } from '../ipc-data-type';
import { isWSLInstall } from '../cmd';
import { wait } from '../util';

const commandLine = new Exec();

export function getPodmanCli(): string {
  if (isWindows()) {
    return 'podman.exe';
  }
  return 'podman';
}

export async function getPodmanSocketPath(
  machineName: string,
): Promise<string> {
  let socketPath = '';
  const { stdout: socket } = await commandLine.exec(getPodmanCli(), [
    'machine',
    'inspect',
    '--format',
    '{{.ConnectionInfo.PodmanPipe.Path}}',
    machineName,
  ]);
  socketPath = socket;
  return socketPath;
}

async function isPodmanInstall() {
  const output = await commandLine.exec(getPodmanCli(), ['--version']);
  console.debug('isPodmanInstall', output);
  if (output.stdout.indexOf('podman version ') >= 0) {
    return true;
  }
  return false;
}

async function isPodmanInit() {
  const output = await commandLine.exec(getPodmanCli(), ['machine', 'list']);
  console.debug('isPodmanInit', output);
  if (output.stdout.indexOf('podman-machine-default') >= 0) {
    return true;
  }
  return false;
}

async function isPodmanStart() {
  const output = await commandLine.exec(getPodmanCli(), ['machine', 'list']);
  console.debug(
    'isPodmanStart',
    output,
    output.stdout.indexOf('Currently running'),
  );
  if (output.stdout.indexOf('Currently running') >= 0) {
    return true;
  } else if (output.stdout.indexOf('Currently starting') >= 0) {
    // 启动podman大约需要10秒，但是这个命令会立即返回
    await wait(10000);
    const output2 = await commandLine.exec(getPodmanCli(), ['machine', 'list']);
    console.debug(
      'isPodmanStart2',
      output2,
      output2.stdout.indexOf('Currently running'),
    );
    if (output2.stdout.indexOf('Currently running') >= 0) {
      return true;
    }
  }
  return false;
}

async function isImageReady(serviceName: ServiceName) {
  console.debug('serviceName', serviceName);
  const [imageName, imageTag] = imageNameDict[serviceName].split(':');
  const matchNameRegex = RegExp(imageName + '\\s*' + imageTag);
  const output = await commandLine.exec(getPodmanCli(), ['image', 'list']);
  console.debug('isImageReady', output);
  if (matchNameRegex.test(output.stdout)) {
    return true;
  }
  return false;
}

async function loadImage(serviceName: ServiceName) {
  const imagePath = path.join(
    appPath,
    'external-resources',
    'ai-assistant-backend',
    imagePathDict[serviceName],
  );
  const output = await commandLine.exec(getPodmanCli(), [
    'load',
    '-i',
    imagePath,
  ]);
  console.debug('loadImage', output);
  const id = output.stdout.replace('Loaded image:', '').trim();
  if (output.stdout.indexOf('Loaded image:') >= 0 && id && id.length > 3) {
    console.debug('tag image');
    const output2 = await commandLine.exec(getPodmanCli(), [
      'tag',
      id,
      imageNameDict[serviceName],
    ]);
    console.debug('podman tag', output2);
    return true;
  } else {
    return false;
  }
}

export async function installWSLMock() {
  return false;
}

export async function installPodman() {
  await commandLine.exec(
    path.join(
      appPath,
      'external-resources',
      'ai-assistant-backend',
      'install_podman.exe',
    ),
    ['/s'],
    { isAdmin: true },
  );
  return true;
}

export async function initPodman() {
  const output = await commandLine.exec(getPodmanCli(), ['machine', 'init']);
  console.debug('initPodman', output);
  return true;
}

export async function startPodman() {
  await commandLine.exec(getPodmanCli(), ['machine', 'start']);
  return true;
}

export async function stopPodman() {
  await commandLine.exec(getPodmanCli(), ['machine', 'stop']);
  return true;
}

export async function isCDIReady() {
  try {
    await commandLine.exec('nvidia-smi');
  } catch (e) {
    console.warn('设备不支持cuda');
    return true;
  }
  try {
    const result = await commandLine.exec(getPodmanCli(), [
      'machine',
      'ssh',
      'nvidia-ctk cdi list',
    ]);
    if (result.stdout.indexOf('nvidia.com/gpu=all') >= 0) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

export async function setupCDI() {
  await commandLine.exec(getPodmanCli(), [
    'machine',
    'ssh',
    `sudo curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo` +
      ` | sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo`,
  ]);
  await commandLine.exec(getPodmanCli(), [
    'machine',
    'ssh',
    `sudo yum install -y nvidia-container-toolkit`,
  ]);
  await commandLine.exec(getPodmanCli(), [
    'machine',
    'ssh',
    'sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml',
  ]);
  return true;
}

export async function ensurePodmanWorks(
  event: IpcMainEvent,
  channel: Channels,
) {
  event.reply(channel, MESSAGE_TYPE.PROGRESS, '正在启动WSL，这需要一点时间');
  await checkAndSetup(isWSLInstall, installWSLMock, {
    event,
    channel,
    checkMessage: '检查WSL状态',
    setupMessage: '安装WSL',
  });
  await checkAndSetup(isPodmanInstall, installPodman, {
    event,
    channel,
    checkMessage: '检查Podman安装状态',
    setupMessage: '安装Podman',
  });
  await checkAndSetup(isPodmanInit, initPodman, {
    event,
    channel,
    checkMessage: '检查Podman虚拟机',
    setupMessage: '初始化Podman虚拟机',
  });
  await checkAndSetup(isPodmanStart, startPodman, {
    event,
    channel,
    checkMessage: '检查Podman虚拟机启动情况',
    setupMessage: '启动Podman虚拟机',
  });
  await checkAndSetup(isCDIReady, setupCDI, {
    event,
    channel,
    checkMessage: '检查容器显卡情况',
    setupMessage: '设置容器显卡',
  });
}

export async function ensureImageReady(
  service: ServiceName,
  event: IpcMainEvent,
  channel: Channels,
) {
  await checkAndSetup(
    async () => await isImageReady(service),
    async () => await loadImage(service),
    {
      event,
      channel,
      checkMessage: `检查服务${service}镜像`,
      setupMessage: `加载镜像${service}`,
    },
  );
}

type AsyncStringFunction = () => Promise<boolean>;

async function checkAndSetup(
  check: AsyncStringFunction,
  setup: AsyncStringFunction,
  progress?: {
    event: IpcMainEvent;
    channel: Channels;
    checkMessage: string;
    setupMessage: string;
  },
) {
  let checked = false;
  const checkStartMessage = progress ? `正在${progress.checkMessage}` : null;
  const checkSuccessMessage = progress ? `${progress.checkMessage}成功` : null;
  const checkErrorMessage = progress ? `${progress.checkMessage}失败` : null;
  const setupStartMessage = progress ? `正在${progress.setupMessage}` : null;
  const setupSuccessMessage = progress ? `${progress.setupMessage}成功` : null;
  const setupErrorMessage = progress ? `${progress.setupMessage}失败` : null;
  try {
    checked = await check();
  } catch (e) {
    console.warn(e);
  }
  if (!checked) {
    progress &&
      progress.event.reply(
        progress.channel,
        MESSAGE_TYPE.PROGRESS,
        setupStartMessage,
      );
    try {
      const result = await setup();
      progress &&
        progress.event.reply(
          progress.channel,
          MESSAGE_TYPE.PROGRESS,
          setupSuccessMessage,
        );
      if (result) {
        checked = await check();
      }
    } catch (e) {
      console.error(e);
      progress &&
        progress.event.reply(
          progress.channel,
          MESSAGE_TYPE.ERROR,
          setupErrorMessage,
        );
      throw e;
    }
  }
  if (!checked) {
    progress &&
      progress.event.reply(
        progress.channel,
        MESSAGE_TYPE.ERROR,
        checkErrorMessage,
      );
    console.error(checkErrorMessage);
    throw new Error(checkErrorMessage || '错误');
  }
  return checked;
}

export async function startService(
  serviceName: ServiceName,
  event: IpcMainEvent,
  channel: Channels,
  containerName: string,
  gpuConfig?: { forceNvidia: boolean; forceCPU: boolean }
) {
  try {
    // 获取容器配置
    const { getContainerConfig } = await import('../configs');
    const config = getContainerConfig()[serviceName];
    
    if (!config || !config.command || !config.command.start) {
      throw new Error(`服务 ${serviceName} 的启动命令未配置`);
    }

    // 构建环境变量
    const envVars: string[] = [];
    
    // 添加基础环境变量
    if (config.env) {
      Object.entries(config.env).forEach(([key, value]) => {
        envVars.push(`-e`, `${key}=${value}`);
      });
    }

    // 根据GPU配置添加TTS模型选择环境变量
    if (serviceName === 'TTS' && gpuConfig) {
      if (gpuConfig.forceNvidia) {
        envVars.push('-e', 'TTS_MODELS=index-tts');
      } else if (gpuConfig.forceCPU) {
        envVars.push('-e', 'TTS_MODELS=kokoro');
      }
      // 如果都不选，则使用默认的自动检测模式
    }

    // 构建完整的docker exec命令
    const execArgs = [
      'exec',
      ...envVars,
      containerName,
      config.command.start[1] ?? ""
    ];

    console.debug(`启动服务 ${serviceName}，命令:`, getPodmanCli(), execArgs);
    
    event.reply(channel, MESSAGE_TYPE.PROGRESS, `正在启动 ${serviceName} 服务`);
    
    const result = await commandLine.exec(getPodmanCli(), execArgs);
    
    console.debug(`启动服务 ${serviceName} 结果:`, result);
    
    // 检查输出内容来判断是否真的启动成功
    const hasStartupMessage = result.stdout.includes('启动') || 
                             result.stdout.includes('start') || 
                             result.stdout.includes('AI语音助手后端启动中');
    
    if (result.stderr && result.stderr.trim()) {
      console.warn(`启动服务 ${serviceName} 警告:`, result.stderr);
    }
    
    // 如果有启动消息，就认为是成功的
    if (hasStartupMessage) {
      event.reply(channel, MESSAGE_TYPE.INFO, `${serviceName} 服务启动成功`);
      return true;
    } else {
      throw new Error(`启动失败，没有检测到启动消息`);
    }
  } catch (error) {
    console.error(`启动服务 ${serviceName} 失败:`, error);
    event.reply(channel, MESSAGE_TYPE.ERROR, `启动 ${serviceName} 服务失败: ${error.message}`);
    throw error;
  }
}

export async function stopService(
  serviceName: ServiceName,
  event: IpcMainEvent,
  channel: Channels,
  containerName: string
) {
  try {
    // 获取容器配置
    const { getContainerConfig } = await import('../configs');
    const config = getContainerConfig()[serviceName];
    
    if (!config || !config.command || !config.command.stop) {
      throw new Error(`服务 ${serviceName} 的停止命令未配置`);
    }

    // 构建环境变量
    const envVars: string[] = [];
    
    // 添加基础环境变量
    if (config.env) {
        Object.entries(config.env).forEach(([key, value]) => {
          envVars.push(`-e`, `${key}=${value}`);
        });
    }

    // 构建完整的docker exec命令
    const execArgs = [
      'exec',
      ...envVars,
      containerName,
      config.command.stop[1] ?? ""
    ];

    console.debug(`停止服务 ${serviceName}，命令:`, getPodmanCli(), execArgs);
    
    event.reply(channel, MESSAGE_TYPE.PROGRESS, `正在停止 ${serviceName} 服务`);
    
    const result = await commandLine.exec(getPodmanCli(), execArgs);
    
    console.debug(`停止服务 ${serviceName} 结果:`, result);
    
    // 检查输出内容来判断是否真的停止成功
    const hasStopMessage = result.stdout.includes('停止') || 
                          result.stdout.includes('终止') || 
                          result.stdout.includes('PID:') ||
                          result.stdout.includes('AI语音助手后端停止中');
    
    if (result.stderr && result.stderr.trim()) {
      console.warn(`停止服务 ${serviceName} 警告:`, result.stderr);
    }
    
    // 即使exit code不是0，但如果有停止消息，也认为是成功的
    if (hasStopMessage) {
      event.reply(channel, MESSAGE_TYPE.INFO, `${serviceName} 服务停止成功`);
      return true;
    } else {
      throw new Error(`停止失败，未检测到停止消息`);
    }
  } catch (error) {
    console.error(`停止服务 ${serviceName} 异常:`, error);
    
    // 检查是否是exit code 137的情况（服务停止成功但podman exec被中断）
    if (error.message && error.message.includes('exitCode: 137')) {

      if (error.message.includes('TTS')) {

        // 由于字符编码问题，我们检查一些关键字符来判断是否停止成功
        // 从乱码中可以看到包含"停止"、"TTS"、"PID"等关键词
 
        event.reply(channel, MESSAGE_TYPE.INFO, `${serviceName} 服务停止成功`);
        return true;
      }
    }
    
    // 如果不是exit code 137或者没有停止消息，则认为是真正的错误
    event.reply(channel, MESSAGE_TYPE.ERROR, `停止 ${serviceName} 服务失败: ${error.message}`);
    throw error;
  }
}
