import { IpcMain } from 'electron';
import Dockerode from 'dockerode';
import { connect } from './connector';
import { LibPod, PodmanContainerInfo } from './libpod-dockerode';
import {
  ActionName,
  containerLogsChannel,
  containerNameDict,
  imageNameDict,
  ServiceName,
} from './type-info';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { cleanMultiplexedLog } from './stream-utils';

let connectionGlobal: LibPod & Dockerode;

export default async function init(ipcMain: IpcMain) {
  if (!connectionGlobal) {
    try {
      connectionGlobal = await connect();
    } catch (e) {
      console.warn(e);
    }
  }
  ipcMain.on(
    containerLogsChannel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      console.debug(containerLogsChannel, action, serviceName);
      // 即使一切准备正常，还有可能遇到 ECONNRESET 错误，所以还要掉一个真实的业务接口测试一下
      if (connectionGlobal) {
        // console.debug('podman is ready');
        let containerInfos: PodmanContainerInfo[] = [];
        containerInfos = await connectionGlobal.listPodmanContainers({
          all: true,
        });
        // console.debug(event, action, serviceName);
        const imageName = imageNameDict[serviceName];
        const containerName = containerNameDict[serviceName];

        const containerInfo = containerInfos.filter(
          (item) => item.Names.indexOf(containerName) >= 0,
        )[0];
        const container =
          containerInfo && connectionGlobal.getContainer(containerInfo.Id);
        // console.debug('container', container);
        if (container) {
          if (action === 'logs') {
            console.debug();
            const logs = (
              await container.logs({
                stdout: true,
                stderr: true,
                timestamps: true,
              })
            ).toString('utf-8');
            // console.debug('logStream', logs);
            event.reply(
              containerLogsChannel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, cleanMultiplexedLog(logs)),
            );
          }
        }
      } else {
        console.debug('还没连接到docker');
        event.reply(
          containerLogsChannel,
          MESSAGE_TYPE.WARNING,
          '还没连接到docker',
        );
        connectionGlobal = await connect();
      }
    },
  );
}
