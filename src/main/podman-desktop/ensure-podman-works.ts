import path from 'node:path';
import type { IpcMainEvent } from 'electron';
import { appPath, Exec } from '../exec';
import { convertWindowsPathToPodmanMachinePath, isWindows } from '../exec/util';
import {
  imageNameDict,
  imagePathDict,
  podMachineName,
  ServiceName,
} from './type-info';
import { Channels, MESSAGE_TYPE } from '../ipc-data-type';
import { isWSLInstall } from '../cmd/is-wsl-install';
import { wait } from '../util';
import { loggerFactory } from '../terminal-log';

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
  if (output.stdout.indexOf(podMachineName) >= 0) {
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
    console.debug('remove default image tag');
    if (id !== imageNameDict[serviceName]) {
      const output3 = await commandLine.exec(getPodmanCli(), [
        'image',
        'rm',
        id,
      ]);
      console.debug('podman image rm', output3);
    }
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
    [],
  );
  return true;
}

export async function initPodman() {
  const podmanMachineImagePath = path.join(
    appPath,
    'external-resources',
    'ai-assistant-backend',
    'podman_machine.tar.zst',
  );
  const imagePathArgs = isWindows()
    ? [
        '--image',
        podmanMachineImagePath,
        '--user-mode-networking'
      ]
    : ['--user-mode-networking'];
  const output = await commandLine.exec(
    getPodmanCli(),
    ['machine', 'init', ...imagePathArgs],
    {
      logger: loggerFactory('podman'),
    },
  );
  console.debug('initPodman', output);
  return true;
}

export async function startPodman() {
  try {
    const output = await commandLine.exec(getPodmanCli(), ['machine', 'start']);
    console.debug('startPodman', output);
  } catch (e) {
    if (e.message.indexOf('already running') >= 0) {
      // 这种情况说明podman因为某种原因卡死在了starting状态
      // 需要通过WSL才能关闭它
      const output2 = await commandLine.exec(
        'wsl.exe',
        ['--shutdown', podMachineName],
        {
          encoding: 'utf16le',
          shell: true,
        },
      );
      console.debug('startPodman2', output2);
      const output3 = await commandLine.exec(getPodmanCli(), [
        'machine',
        'start',
      ]);
      console.debug('startPodman3', output3);
    }
  }
  return true;
}

export async function stopPodman() {
  await commandLine.exec(getPodmanCli(), ['machine', 'stop']);
  return true;
}

/** 有nvidia驱动，且没安装nvidia-ctk就算没准备好
 * 其他情况不需要安装nvidia-ctk，所以其他情况都算准备好了 */
export async function isCDIReady() {
  try {
    const result = await commandLine.exec('nvidia-smi');
    console.debug('isCDIReady', result);
  } catch (e) {
    console.warn('isCDIReady', '未安装Nvidia驱动');
    return true;
  }
  try {
    const result = await commandLine.exec(getPodmanCli(), [
      'machine',
      'ssh',
      'nvidia-ctk cdi list',
    ]);
    console.debug('isCDIReady', result);
    if (result.stdout.indexOf('nvidia.com/gpu=all') >= 0) {
      return true;
    } else if (result.stdout.indexOf('Found0 CDI devices"') >= 0) {
      console.warn('isCDIReady', '没有找到可用CDI设备');
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

export async function setupCDI() {
  await commandLine.exec(
    getPodmanCli(),
    [
      'machine',
      'ssh',
      'cp',
      `'${convertWindowsPathToPodmanMachinePath(
        path.join(
          appPath,
          'external-resources',
          'ai-assistant-backend',
          'nvidia-container-toolkit_x86_64.tar.gz',
        ),
      )}'`,
      '~/',
    ],
    {
      logger: loggerFactory('podman'),
    },
  );
  try {
    await commandLine.exec(
      getPodmanCli(),
      [
        'machine',
        'ssh',
        'tar',
        '-zxvf',
        '~/nvidia-container-toolkit_x86_64.tar.gz',
        '-C',
        '~/',
      ],
      {
        logger: loggerFactory('podman'),
      },
    );
    await commandLine.exec(
      getPodmanCli(),
      [
        'machine',
        'ssh',
        'sudo',
        'rpm',
        '-i',
        '~/release-v1.17.8-stable/packages/centos7/x86_64/libnvidia-container1-1.17.8-1.x86_64.rpm',
      ],
      {
        logger: loggerFactory('podman'),
      },
    );
    await commandLine.exec(
      getPodmanCli(),
      [
        'machine',
        'ssh',
        'sudo',
        'rpm',
        '-i',
        '~/release-v1.17.8-stable/packages/centos7/x86_64/libnvidia-container-tools-1.17.8-1.x86_64.rpm',
      ],
      {
        logger: loggerFactory('podman'),
      },
    );
    await commandLine.exec(
      getPodmanCli(),
      [
        'machine',
        'ssh',
        'sudo',
        'rpm',
        '-i',
        '~/release-v1.17.8-stable/packages/centos7/x86_64/nvidia-container-toolkit-base-1.17.8-1.x86_64.rpm',
      ],
      {
        logger: loggerFactory('podman'),
      },
    );
    await commandLine.exec(
      getPodmanCli(),
      [
        'machine',
        'ssh',
        'sudo',
        'rpm',
        '-i',
        '~/release-v1.17.8-stable/packages/centos7/x86_64/nvidia-container-toolkit-1.17.8-1.x86_64.rpm',
      ],
      {
        logger: loggerFactory('podman'),
      },
    );
  } catch (e) {
    console.warn(e);
    if (e && e.message && e.message.indexOf('already installed') >= 0) {
      console.warn('nvidia-container-toolkit 已经安装');
    } else {
      throw e;
    }
  }

  await commandLine.exec(
    getPodmanCli(),
    [
      'machine',
      'ssh',
      'sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml',
    ],
    {
      logger: loggerFactory('podman'),
    },
  );
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
  const result = await commandLine.exec(getPodmanCli(), [
    'image',
    'rm',
    imageNameDict[serviceName],
  ]);
  console.debug(result);
  const result2 = await commandLine.exec(getPodmanCli(), [
    'image',
    'prune',
    '--all',
    '--force',
  ]);
  console.debug(result2);
  return result;
}

export async function haveCDIGPU() {
  try {
    const result = await commandLine.exec('nvidia-smi');
    console.debug('haveCDIGPU', result);
  } catch (e) {
    console.warn('haveCDIGPU', '未安装nvidia驱动');
    return false;
  }
  try {
    const result = await commandLine.exec(getPodmanCli(), [
      'machine',
      'ssh',
      'nvidia-ctk cdi list',
    ]);
    console.debug('haveCDIGPU', result);
    if (result.stdout.indexOf('nvidia.com/gpu=all') >= 0) {
      return true;
    } else if (result.stdout.indexOf('Found 0 CDI devices') >= 0) {
      console.warn('haveCDIGPU', '没有找到可用CDI设备');
      return false;
    }
    return false;
  } catch (e) {
    console.warn('haveCDIGPU', e);
    return false;
  }
}

export async function resetPodman() {
  try {
    await commandLine.exec(getPodmanCli(), ['machine', 'stop']);
  } catch (e) {
    console.warn(e);
  }
  return commandLine.exec(getPodmanCli(), ['machine', 'reset', '--force']);
}
