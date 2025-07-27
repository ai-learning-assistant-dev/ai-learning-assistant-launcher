import { dialog, IpcMain } from 'electron';
import Dockerode from 'dockerode';
import { connect } from './connector';
import { LibPod, PodmanContainerInfo } from './libpod-dockerode';
import {
  ActionName,
  channel,
  containerNameDict,
  imageNameDict,
  ServiceName,
} from './type-info';
import {
  ensurePodmanWorks,
  haveNvidia,
  isImageReady,
  loadImageFromPath,
  removeImage,
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
async function improveStablebility<T>(func: () => Promise<T>) {
  try {
    return await func();
  } catch (e) {
    console.debug('稳定器检测到任务执行出错，正在尝试重启podman');
    console.warn(e);
    if (e) {
      try {
        if (
          e &&
          e.message &&
          (e.message.indexOf('socket hang up') >= 0 ||
            e.message.indexOf('exitCode: 125') >= 0 ||
            e.message.indexOf('connect ENOENT') >= 0)
        ) {
          await stopPodman();
          await wait(1000);
          await startPodman();
        }
        await wait(1000);
        try {
          connectionGlobal = await connect();
        } catch (e) {
          console.warn('无法创建podman连接');
          console.warn(e);
          connectionGlobal = null;
          throw e;
        }
        await wait(1000);
        return func();
      } catch (e) {
        console.error(e);
        throw e;
      }
    } else {
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
      try {
        let imagePath: boolean | string = false;
        if (action === 'install') {
          let imageReady = false;
          try {
            imageReady = await isImageReady(serviceName);
          } catch (e) {
            console.info(e);
          }
          if (!imageReady) {
            imagePath = await selectImageFile(serviceName);
            if (!imagePath) {
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                '没有选择到正确的镜像文件',
              );
              return;
            }
          }

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
          try {
            containerInfos = await improveStablebility(async () => {
              const result = await connectionGlobal.listPodmanContainers({
                all: true,
              });
              return result;
            });
          } catch (e) {
            console.debug('无法获取容器列表');
            console.error(e);
          }
          console.debug('containerInfos', containerInfos);

          if (action === 'query') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, containerInfos),
            );
            return;
          }
          console.debug(action, serviceName);
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
                try {
                  await container.start();
                  event.reply(channel, MESSAGE_TYPE.INFO, '成功启动服务');
                } catch (e) {
                  console.error(e);
                  if (
                    e &&
                    e.message &&
                    e.message.indexOf(
                      'unresolvable CDI devices nvidia.com/gpu=all',
                    ) >= 0
                  ) {
                    event.reply(
                      channel,
                      MESSAGE_TYPE.ERROR,
                      '无法识别NVIDIA显卡，请修改设置后重试',
                    );
                  } else if (
                    e &&
                    e.message &&
                    e.message.indexOf('No such file or directory') >= 0
                  ) {
                    await reCreateContainerAndStart(
                      event,
                      container,
                      serviceName,
                    );
                  } else {
                    event.reply(channel, MESSAGE_TYPE.ERROR, '无法启动服务');
                  }
                }
              });
            } else if (action === 'stop') {
              await improveStablebility(async () => {
                await container.stop();
                event.reply(channel, MESSAGE_TYPE.INFO, '成功停止服务');
              });
            } else if (action === 'remove') {
              await improveStablebility(async () => {
                await container.remove();
                const imageName = imageNameDict[serviceName];
                const containerName = containerNameDict[serviceName];
                let containersHaveSameImage = [];
                containerInfos.forEach((item) => {
                  containersHaveSameImage = containersHaveSameImage.concat(
                    item.Names,
                  );
                });

                containersHaveSameImage = containersHaveSameImage.filter(
                  (item) => {
                    return (
                      item !== containerName ||
                      imageNameDict[item] !== imageName
                    );
                  },
                );

                console.debug(
                  'containersHaveSameImage',
                  containersHaveSameImage,
                );

                if (containersHaveSameImage.length === 0) {
                  await removeImage(serviceName);
                }

                event.reply(channel, MESSAGE_TYPE.INFO, '成功删除服务');
              });
            } else if (action === 'update') {
              const result = await improveStablebility(async () => {
                const imagePathForUpdate = await selectImageFile(serviceName);
                if (imagePathForUpdate) {
                  event.reply(
                    channel,
                    MESSAGE_TYPE.PROGRESS,
                    '正在导入镜像，这可能需要5分钟时间',
                  );
                  return loadImageFromPath(serviceName, imagePathForUpdate);
                } else {
                  return false;
                }
              });
              if (result) {
                event.reply(channel, MESSAGE_TYPE.PROGRESS, '正在删除旧版服务');
                await removeContainer(serviceName);
                event.reply(
                  channel,
                  MESSAGE_TYPE.PROGRESS,
                  '正在重新创建新服务',
                );
                try {
                  await createContainer(serviceName);
                  event.reply(channel, MESSAGE_TYPE.INFO, '更新服务成功');
                } catch (e) {
                  console.error(e);
                  event.reply(channel, MESSAGE_TYPE.ERROR, '更新服务失败');
                }
              } else {
                event.reply(channel, MESSAGE_TYPE.ERROR, '未选择正确的镜像');
                return;
              }
            }
          } else if (action === 'install') {
            console.debug('install', imageName);
            if (!(await isImageReady(serviceName))) {
              event.reply(
                channel,
                MESSAGE_TYPE.PROGRESS,
                '正在导入镜像，这可能需要5分钟时间',
              );
              if (
                !(await improveStablebility(async () => {
                  return loadImageFromPath(serviceName, imagePath as string);
                }))
              ) {
                event.reply(channel, MESSAGE_TYPE.ERROR, '未选择正确的镜像');
                return;
              }
            }
            event.reply(channel, MESSAGE_TYPE.PROGRESS, '正在创建容器');
            const newContainerInfo:
              | {
                  Id: string;
                  Warnings: string[];
                }
              | undefined = await improveStablebility(async () => {
              try {
                // 这里不要简化成return createContainer(serviceName);会导致无法捕获错误
                const result = await createContainer(serviceName);
                return result;
              } catch (e) {
                console.debug('安装服务失败', e);
                if (e && e.message && e.message.indexOf('ENOENT') >= 0) {
                  event.reply(
                    channel,
                    MESSAGE_TYPE.ERROR,
                    '启动器安装目录缺少服务配置文件，请重新下载安装启动器',
                  );
                } else {
                  throw e;
                }
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
          if (action !== 'query') {
            event.reply(channel, MESSAGE_TYPE.WARNING, '还没连接到docker');
          } else if (action === 'query') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, []),
            );
            return;
          }
          console.debug('还没连接到docker');
        }
      } catch (e) {
        console.error(e);
        event.reply(channel, MESSAGE_TYPE.ERROR, '出现错误');
      }
    },
  );
}

export async function createContainer(serviceName: ServiceName) {
  console.debug('创建容器', serviceName);
  const imageName = imageNameDict[serviceName];
  const containerName = containerNameDict[serviceName];
  const config = getContainerConfig()[serviceName];
  const haveNvidiaFlag = await haveNvidia();
  
  // 基础配置
  const containerOptions: any = {
    image: imageName,
    name: containerName,
    devices: haveNvidiaFlag ? [{ path: 'nvidia.com/gpu=all' }] : [],
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
  };

  // 为PDF容器添加特殊配置
  if (serviceName === 'PDF') {
    containerOptions.privileged = true; // 启用特权模式以支持ipc: host等配置
    // 添加重启策略
    containerOptions.restart_policy = 'always';
  }

  return connectionGlobal.createPodmanContainer(containerOptions);
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

export async function selectImageFile(serviceName: ServiceName) {
  if (serviceName === 'TTS' || serviceName === 'ASR') {
    const result = await dialog.showOpenDialog({
      title: '请选择后缀名为.tar的镜像文件',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: '', extensions: ['tar'] }],
    });
    const path = result.filePaths[0];
    if (path && path.length > 0) {
      try {
        return path;
      } catch (e) {
        console.error(e);
        return false;
      }
    } else {
      console.warn('没有选择正确的镜像');
      return false;
    }
  } else if (serviceName === 'PDF') {
    const result = await dialog.showOpenDialog({
      title: '请选择PDF服务的镜像文件',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: 'PDF服务镜像', extensions: ['tar'] }],
    });
    const path = result.filePaths[0];
    if (path && path.length > 0) {
      try {
        return path;
      } catch (e) {
        console.error(e);
        return false;
      }
    } else {
      console.warn('没有选择正确的PDF镜像');
      return false;
    }
  }
  return false;
}

async function reCreateContainerAndStart(
  event: Electron.IpcMainEvent,
  container: Dockerode.Container,
  serviceName: ServiceName,
) {
  console.debug('正在重新创建服务', serviceName);
  await container.remove();
  let newContainerInfo;
  try {
    newContainerInfo = await createContainer(serviceName);
  } catch (e) {
    console.error(e);
    if (e && e.message && e.message.indexOf('ENOENT') >= 0) {
      // 这里用INFO是为了触发前端页面刷新
      event.reply(
        channel,
        MESSAGE_TYPE.INFO,
        '启动器安装目录缺少服务配置文件，请重新下载安装启动器',
      );
    } else {
      // 这里用INFO是为了触发前端页面刷新
      event.reply(channel, MESSAGE_TYPE.INFO, '重新创建服务失败');
    }
    return;
  }

  const containerName = containerNameDict[serviceName];

  let containerInfos: PodmanContainerInfo[] = [];
  containerInfos = await improveStablebility(async () => {
    return connectionGlobal.listPodmanContainers({
      all: true,
    });
  });
  const containerInfo = containerInfos.filter(
    (item) => item.Names.indexOf(containerName) >= 0,
  )[0];
  const newContainer =
    containerInfo && connectionGlobal.getContainer(newContainerInfo.Id);
  if (newContainer) {
    try {
      await newContainer.start();
      event.reply(channel, MESSAGE_TYPE.INFO, '成功启动服务');
    } catch (e) {
      console.error(e);
      if (
        e &&
        e.message &&
        e.message.indexOf('unresolvable CDI devices nvidia.com/gpu=all') >= 0
      ) {
        event.reply(
          channel,
          MESSAGE_TYPE.ERROR,
          '无法识别NVIDIA显卡，请修改设置后重试',
        );
      } else if (
        e &&
        e.message &&
        e.message.indexOf('No such file or directory') >= 0
      ) {
        event.reply(
          channel,
          MESSAGE_TYPE.ERROR,
          '启动器安装目录缺少服务配置文件，请重新下载安装启动器',
        );
      }
    }
  } else {
    event.reply(channel, MESSAGE_TYPE.ERROR, '重新创建服务失败');
  }
}
