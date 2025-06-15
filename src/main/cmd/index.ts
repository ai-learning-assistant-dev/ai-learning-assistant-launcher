import { IpcMain } from 'electron';
import { ActionName, ServiceName } from './type-info';

let connectionGlobal: any;

export default async function init(ipcMain: IpcMain) {
  if (!connectionGlobal) {
    connectionGlobal = await connect();
  }
  ipcMain.on(
    'cmd',
    async (event, action: ActionName, serviceName: ServiceName) => {
      const containerInfos = await connectionGlobal.listPodmanContainers({
        all: true,
      });
      console.debug('containerInfos', containerInfos);
      if (action === 'query') {
        event.reply('docker', 'data', containerInfos);
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
      if (connectionGlobal) {
        if (container) {
          if (action === 'start') {
            await container.start();
            event.reply('docker', 'info', '成功启动');
          } else if (action === 'stop') {
            await container.stop();
            event.reply('docker', 'info', '成功停止');
          } else if (action === 'remove') {
            await container.remove();
            event.reply('docker', 'info', '成功删除');
          }
        } else if (action === 'install') {
          console.debug('install', imageName);
          const newContainerInfo = await connectionGlobal.createPodmanContainer(
            {
              image: imageName,
              name: containerName,
              devices: [{ path: 'nvidia.com/gpu=all' }],
            },
          );
          console.debug('newContainerInfo', newContainerInfo);
          if (newContainerInfo) {
            console.debug('安装成功');
            event.reply('docker', 'info', '安装成功');
          } else {
            console.debug('安装失败');
            event.reply('docker', 'error', '安装失败');
          }
        } else {
          console.debug('没找到容器');
          event.reply('docker', 'error', '没找到容器');
        }
      } else {
        console.debug('还没连接到docker');
        event.reply('docker', 'error', '还没连接到docker');
      }
    },
  );
}
