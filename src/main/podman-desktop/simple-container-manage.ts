import { IpcMain } from 'electron';
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
  startPodman,
  stopPodman,
} from './ensure-podman-works';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getContainerConfig } from '../configs';
import { wait } from '../util';

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
        await wait(1000);
        await startPodman();
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
          }
        } else if (action === 'install') {
          console.debug('install', imageName);
          await ensureImageReady(serviceName, event, channel);
          const config = getContainerConfig()[serviceName];
          let newContainerInfo:
            | {
                Id: string;
                Warnings: string[];
              }
            | undefined;
          newContainerInfo = await improveStablebility(async () => {
            try {
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
              });
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
            await improveStablebility(async () => {
              const newContainer = connectionGlobal.getContainer(
                newContainerInfo.Id,
              );
              await newContainer.start();
              event.reply(channel, MESSAGE_TYPE.INFO, '成功启动服务');
            });
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
