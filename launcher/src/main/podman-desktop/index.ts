import { IpcMain } from 'electron';
import Dockerode from 'dockerode';
import { connect } from './connector';
import { LibPod, PodmanContainerInfo } from './libpod-dockerode';
import {
  ActionName,
  channel,
  imageNameDict,
  MESSAGE_TYPE,
  podMachineName,
  ServiceName,
} from './type-info';
import { Channels } from '../preload';
import {
  ensureImageReady,
  ensurePodmanWorks,
  startPodman,
  stopPodman,
} from './ensure-podman-works';

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
        await stopPodman();
        await startPodman();
        connectionGlobal = await connect();
        return await func();
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
        await improveStablebility(async () => {
          containerInfos = await connectionGlobal.listPodmanContainers({
            all: true,
          });
        });
        console.debug('containerInfos', containerInfos);

        if (action === 'query') {
          event.reply(channel, MESSAGE_TYPE.DATA, containerInfos);
          return;
        }
        console.debug(event, action, serviceName);
        const imageName = imageNameDict[serviceName];
        const containerName = serviceName;

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
          }
        } else if (action === 'install') {
          console.debug('install', imageName);
          await ensureImageReady(serviceName, event, channel);
          let newContainerInfo: {
            Id: string;
            Warnings: string[];
          } | null = null;
          await improveStablebility(async () => {
            newContainerInfo = await connectionGlobal.createPodmanContainer({
              image: imageName,
              name: containerName,
              devices: [{ path: 'nvidia.com/gpu=all' }],
            });
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
      }
    },
  );
}
