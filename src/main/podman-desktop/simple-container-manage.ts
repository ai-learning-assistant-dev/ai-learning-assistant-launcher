import { dialog, IpcMain } from 'electron';
import Dockerode from 'dockerode';
import { connect } from './connector';
import { LibPod, PodmanContainerInfo } from './libpod-dockerode';
import {
  ActionName,
  channel,
  containerNameDict,
  getMergedContainerConfig,
  imageNameDict,
  podMachineName,
  ServiceName,
} from './type-info';
import {
  ensureImageReady,
  ensurePodmanWorks,
  isImageReady,
  loadImageFromPath,
  startPodman,
  stopPodman,
} from './ensure-podman-works';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getContainerConfig } from '../configs';
import { wait } from '../util';
import path from 'node:path';
import { appPath } from '../exec';
import { isWindows } from '../exec/util';
import convertPath from '@stdlib/utils-convert-path';

let connectionGlobal: LibPod & Dockerode;

/** 解决 ipcMain 的监听函数不显示错误日志问题 */
async function improveStablebility(func: () => Promise<any>) {
  try {
    return await func();
  } catch (e) {
    console.warn(e);
    if (e) {
      try {
        console.warn(e);
        // await stopPodman();
        // await wait(1000);
        // await startPodman();
        await wait(1000);
        connectionGlobal = await connect();
        await wait(1000);
        return func();
      } catch (e) {
        console.error(e);
        throw e;
      }
    } else {
      console.error(e);
      throw e;
    }
  }
}

export default async function init(ipcMain: IpcMain) {
  if (!connectionGlobal) {
    try {
      connectionGlobal = await connect();
    } catch (e) {
      console.warn(e);
    }
  }
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      if (action === 'install') {
        try {
          await ensurePodmanWorks(event, channel);
          if (!connectionGlobal) {
            connectionGlobal = await connect();
          }
        } catch (e) {
          console.error(e);
          console.debug('安装podman失败');
          event.reply(channel, MESSAGE_TYPE.ERROR, '安装podman失败');
          return;
        }
      }

      // 即使一切准备正常，还有可能遇到 ECONNRESET 错误，所以还要掉一个真实的业务接口测试一下

      if (connectionGlobal) {
        console.debug('podman is ready');
        let containerInfos: PodmanContainerInfo[] = [];
        containerInfos = await improveStablebility(async () => {
          return connectionGlobal.listPodmanContainers({
            all: true,
          });
        });
        console.debug('containerInfos', containerInfos);

        if (action === 'query') {
          event.reply(
            channel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName, containerInfos),
          );
          return;
        }
        console.debug(event, action, serviceName);
        const imageName = imageNameDict[serviceName];
        const containerName = containerNameDict[serviceName];

        const containerInfo = containerInfos.filter(
          (item) => item.Names.indexOf(containerName) >= 0,
        )[0];
        const container =
          containerInfo && connectionGlobal.getContainer(containerInfo.Id);
        console.debug('container', container);
        if (container) {
          if (action === 'start') {
            await improveStablebility(async () => {
              await container.start();
              event.reply(channel, MESSAGE_TYPE.INFO, '成功启动服务');
            });
          } else if (action === 'stop') {
            await improveStablebility(async () => {
              await container.stop();
              event.reply(channel, MESSAGE_TYPE.INFO, '成功停止服务');
            });
          } else if (action === 'remove') {
            await improveStablebility(async () => {
              await container.remove();
              event.reply(channel, MESSAGE_TYPE.INFO, '成功删除服务');
            });
          } else if (action === 'update') {
            // TODO 更新容器镜像版本
            event.reply(channel, MESSAGE_TYPE.PROGRESS, '正在加载镜像');
            const result = await updateImage(serviceName);
            if (result) {
              event.reply(channel, MESSAGE_TYPE.PROGRESS, '正在删除旧版服务');
              await removeContainer(serviceName);
              event.reply(channel, MESSAGE_TYPE.PROGRESS, '正在重新创建新服务');
              await createContainer(serviceName);
              event.reply(channel, MESSAGE_TYPE.INFO, '更新服务成功');
            } else {
              event.reply(channel, MESSAGE_TYPE.ERROR, '更新服务失败');
            }
          }
        } else if (action === 'install') {
          console.debug('install', imageName);
          if (!(await isImageReady(serviceName))) {
            if (!(await updateImage(serviceName))) {
              event.reply(channel, MESSAGE_TYPE.INFO, '为选择正确的镜像');
              return;
            }
          }
          const newContainerInfo:
            | {
                Id: string;
                Warnings: string[];
              }
            | undefined = await improveStablebility(async () => {
            try {
              return createContainer(serviceName);
            } catch (e) {
              console.debug('安装服务失败', e);
              event.reply(channel, MESSAGE_TYPE.INFO, '安装服务失败');
              return;
            }
          });

          console.debug('newContainerInfo', newContainerInfo);
          if (newContainerInfo) {
            console.debug('安装服务成功');
            event.reply(channel, MESSAGE_TYPE.INFO, '安装服务成功');
          } else {
            console.debug('安装服务失败');
            event.reply(channel, MESSAGE_TYPE.ERROR, '安装服务失败');
          }
        } else {
          console.debug('没找到容器');
          event.reply(channel, MESSAGE_TYPE.WARNING, '没找到容器');
        }
      } else {
        console.debug('还没连接到docker');
        event.reply(channel, MESSAGE_TYPE.WARNING, '还没连接到docker');
        connectionGlobal = await connect();
      }
    },
  );
}

export async function createContainer(serviceName: ServiceName) {
  console.debug('创建容器', serviceName);
  const imageName = imageNameDict[serviceName];
  const containerName = containerNameDict[serviceName];
  const config = getContainerConfig()[serviceName];
  return connectionGlobal.createPodmanContainer({
    image: imageName,
    name: containerName,
    devices: [{ path: 'nvidia.com/gpu=all' }],
    portmappings: config.port.map((p) => ({
      container_port: p.container,
      host_port: p.host,
    })),
    command: config.command.start,
    env: config.env,
    mounts: config.mounts
      ? config.mounts.map((mount) => {
          mount.Source = path.join(appPath, mount.Source);
          if (isWindows()) {
            mount.Source = `/mnt${convertPath(mount.Source, 'posix')}`;
          }
          return mount;
        })
      : [],
  });
}

export async function startContainer(containerId: string) {
  const newContainer = connectionGlobal.getContainer(containerId);
  return newContainer.start();
}

export async function removeContainer(serviceName: ServiceName) {
  const containerInfos: PodmanContainerInfo[] =
    await connectionGlobal.listPodmanContainers({
      all: true,
    });
  const containerName = containerNameDict[serviceName];

  const containerInfo = containerInfos.filter(
    (item) => item.Names.indexOf(containerName) >= 0,
  )[0];
  const container =
    containerInfo && connectionGlobal.getContainer(containerInfo.Id);

  console.debug('准备删除的容器', containerInfo, container);
  if (container) {
    try {
      await container.stop();
    } catch (e) {
      if (
        !(e && e.message && e.message.indexOf('container already stopped') >= 0)
      ) {
        console.warn(e);
        throw e;
      }
    }
    await container.remove();
  }
}

export async function updateImage(serviceName: ServiceName) {
  if (serviceName === 'TTS' || serviceName === 'ASR') {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: '', extensions: ['tar'] }],
    });
    const path = result.filePaths[0];
    if (path && path.length > 0) {
      try {
        return loadImageFromPath(serviceName, path);
      } catch (e) {
        console.error(e);
        return false;
      }
    } else {
      console.warn('没有选择正确的镜像');
      return false;
    }
  }
  return false;
}
