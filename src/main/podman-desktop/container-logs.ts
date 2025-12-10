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
import { getServiceLogs } from './simple-container-manage';

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
        try {
          const { imageId, logs } = await getServiceLogs(serviceName);
          event.reply(
            containerLogsChannel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName, {
              imageId: imageId,
              logs: logs,
            }),
          );
        } catch (e) {
          console.error(e);
        }
      } else {
        console.debug('还没连接到docker');
        // event.reply(
        //   containerLogsChannel,
        //   MESSAGE_TYPE.WARNING,
        //   '还没连接到docker',
        // );
        connectionGlobal = await connect();
      }
    },
  );
}
