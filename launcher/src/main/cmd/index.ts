import { IpcMain } from 'electron';
import { ActionName, ServiceName } from './type-info';
import { Exec } from '../exec';

const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {

  ipcMain.on(
    'cmd',
    async (event, action: ActionName, serviceName: ServiceName) => {

      if (commandLine) {
        if (container) {
          if (action === 'start') {
            commandLine.exec()
          } else if (action === 'stop') {
            await container.stop();
            event.reply('docker', 'info', '成功停止');
          } else if (action === 'remove') {
            await container.remove();
            event.reply('docker', 'info', '成功删除');
          }
        } else if (action === 'install') {
          console.debug('install', imageName);
          const newContainerInfo = await commandLine.createPodmanContainer(
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
