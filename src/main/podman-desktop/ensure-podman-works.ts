import path from 'node:path';
import type { IpcMainEvent } from 'electron';
import { appPath, Exec } from '../exec';
import { isWindows } from '../exec/util';
import { imageNameDict, imagePathDict, ServiceName } from './type-info';
import { Channels, MESSAGE_TYPE } from '../ipc-data-type';
import { isWSLInstall } from '../cmd';

// 日志发送函数
function sendInstallLog(event: IpcMainEvent, level: 'info' | 'warning' | 'error' | 'success', service: string, message: string) {
  event.reply('service-logs', {
    level,
    service,
    message,
    timestamp: new Date().toISOString(),
  });
}

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
  console.debug('isPodmanStart', output, output.stdout.indexOf('Currently running'));
  if (output.stdout.indexOf('Currently running') >= 0) {
    return true;
  }
  return false;
}

async function isImageReady(serviceName: ServiceName) {
  console.debug('serviceName', serviceName);
  const output = await commandLine.exec(getPodmanCli(), ['image', 'list']);
  console.debug('isImageReady', output);
  if (
    output.stdout.indexOf(imageNameDict[serviceName].replace(':latest', '')) >=
    0
  ) {
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
    )
  
  console.debug(`开始加载镜像: ${imagePath}`);
  const output = await commandLine.exec(getPodmanCli(), [
    'load',
    '-i',
    imagePath
  ]);
  console.debug("loadImage",output)
  const id = output.stdout.split(":").pop();
  if(output.stdout.indexOf("Loaded image")>=0 &&id&&id.length > 25){
    console.debug(`镜像加载成功，ID: ${id}`);
    const output2 = await commandLine.exec(getPodmanCli(), [
      'tag',
      id,
      imageNameDict[serviceName],
    ]);
    console.debug("podman tag", output2)
    console.debug(`镜像标签设置成功: ${imageNameDict[serviceName]}`);
    return true;
  }else{
    console.debug('镜像加载失败');
    return false;
  }
}

export async function installWSLMock() {
  return false;
}

export async function installPodman() {
  await commandLine.exec(
    path.join(appPath, 'external-resources', 'ai-assistant-backend', 'install_podman.exe'),
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
  event.reply(channel,MESSAGE_TYPE.PROGRESS,"正在启动WSL，这需要一点时间")
  sendInstallLog(event, 'info', 'System', '开始检查容器环境');
  
  await checkAndSetup(isWSLInstall, installWSLMock, {
    event,
    channel,
    checkMessage: '检查WSL状态',
    setupMessage: '安装WSL',
  });
  sendInstallLog(event, 'success', 'System', 'WSL环境检查完成');
  
  await checkAndSetup(isPodmanInstall, installPodman, {
    event,
    channel,
    checkMessage: '检查Podman安装状态',
    setupMessage: '安装Podman',
  });
  sendInstallLog(event, 'success', 'System', 'Podman安装检查完成');
  
  await checkAndSetup(isPodmanInit, initPodman, {
    event,
    channel,
    checkMessage: '检查Podman虚拟机',
    setupMessage: '初始化Podman虚拟机',
  });
  sendInstallLog(event, 'success', 'System', 'Podman虚拟机初始化完成');
  
  await checkAndSetup(isPodmanStart, startPodman, {
    event,
    channel,
    checkMessage: '检查Podman虚拟机启动情况',
    setupMessage: '启动Podman虚拟机',
  });
  sendInstallLog(event, 'success', 'System', 'Podman虚拟机启动完成');
  
  await checkAndSetup(isCDIReady, setupCDI, {
    event,
    channel,
    checkMessage: '检查容器显卡情况',
    setupMessage: '设置容器显卡',
  });
  sendInstallLog(event, 'success', 'System', 'GPU支持配置完成');
}

export async function ensureImageReady(
  service: ServiceName,
  event: IpcMainEvent,
  channel: Channels,
) {
  sendInstallLog(event, 'info', service, '开始检查容器镜像');
  
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
  
  sendInstallLog(event, 'success', service, '容器镜像检查完成');
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
          MESSAGE_TYPE.PROGRESS_ERROR,
          setupErrorMessage,
        );
      throw e;
    }
  }
  if (!checked) {
    progress &&
      progress.event.reply(
        progress.channel,
        MESSAGE_TYPE.PROGRESS_ERROR,
        checkErrorMessage,
      );
    console.error(checkErrorMessage);
    throw new Error(checkErrorMessage || '错误');
  }
  return checked;
}
