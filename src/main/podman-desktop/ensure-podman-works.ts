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

export async function isImageReady(serviceName: ServiceName) {
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

export async function loadImageFromPath(
  serviceName: ServiceName,
  imagePath: string,
) {
  try {
    await commandLine.exec(getPodmanCli(), [
      'image',
      'rm',
      imageNameDict[serviceName],
    ]);
  } catch (e) {
    console.warn(e);
  }

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

async function loadImage(serviceName: ServiceName) {
  const imagePath = path.join(
    appPath,
    'external-resources',
    'ai-assistant-backend',
    imagePathDict[serviceName],
  );
  return loadImageFromPath(serviceName, imagePath);
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

export async function removeImage(serviceName: ServiceName) {
  const result = commandLine.exec(getPodmanCli(), [
    'image',
    'rm',
    imageNameDict[serviceName],
  ]);
  return result;
}
