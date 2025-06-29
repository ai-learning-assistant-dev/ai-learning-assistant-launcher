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
  getPodmanCli,
} from './ensure-podman-works';
import { Exec } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getContainerConfig } from '../configs';
import { wait } from '../util';

const commandLine = new Exec();

// 日志发送函数
function sendInstallLog(event: any, level: 'info' | 'warning' | 'error' | 'success', service: string, message: string) {
  event.reply('service-logs', {
    level,
    service,
    message,
    timestamp: new Date().toISOString(),
  });
}

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
          sendInstallLog(event, 'info', serviceName, '开始安装容器服务');
          await ensurePodmanWorks(event, channel);
          sendInstallLog(event, 'success', serviceName, 'Podman环境准备完成');
          
          if (!connectionGlobal) {
            sendInstallLog(event, 'info', serviceName, '正在连接到Podman...');
            connectionGlobal = await connect();
            sendInstallLog(event, 'success', serviceName, 'Podman连接成功');
          }
        } catch (e) {
          console.error(e);
          console.debug('安装podman失败');
          sendInstallLog(event, 'error', serviceName, `Podman环境准备失败: ${e}`);
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
            try {
              sendInstallLog(event, 'info', serviceName, '正在启动容器...');
              await improveStablebility(async () => {
                await container.start();
                event.reply(channel, MESSAGE_TYPE.INFO, '成功启动服务');
              });
              sendInstallLog(event, 'success', serviceName, '容器启动成功');
            } catch (e) {
              sendInstallLog(event, 'error', serviceName, `容器启动失败: ${e}`);
            }
          } else if (action === 'stop') {
            try {
              sendInstallLog(event, 'info', serviceName, '正在停止容器...');
              await improveStablebility(async () => {
                await container.stop();
                event.reply(channel, MESSAGE_TYPE.INFO, '成功停止服务');
              });
              sendInstallLog(event, 'success', serviceName, '容器停止成功');
              
              // 容器停止后，通知前端重置服务状态
              try {
                event.sender.send('container-stopped', {
                  serviceName,
                  containerName,
                  timestamp: new Date().toISOString()
                });
                sendInstallLog(event, 'info', serviceName, '已通知前端重置服务状态');
              } catch (e) {
                console.warn('发送容器停止通知失败:', e);
              }
            } catch (e) {
              sendInstallLog(event, 'error', serviceName, `容器停止失败: ${e}`);
            }
          } else if (action === 'remove') {
            try {
              sendInstallLog(event, 'info', serviceName, '正在删除容器...');
              await improveStablebility(async () => {
                await container.remove();
                event.reply(channel, MESSAGE_TYPE.INFO, '成功删除服务');
              });
              sendInstallLog(event, 'success', serviceName, '容器删除成功');
              
              // 容器删除后，通知前端重置服务状态
              try {
                event.sender.send('container-stopped', {
                  serviceName,
                  containerName,
                  timestamp: new Date().toISOString()
                });
                sendInstallLog(event, 'info', serviceName, '已通知前端重置服务状态');
              } catch (e) {
                console.warn('发送容器停止通知失败:', e);
              }
            } catch (e) {
              sendInstallLog(event, 'error', serviceName, `容器删除失败: ${e}`);
            }
          }
        } else if (action === 'install') {
          // 检查是否为语音服务相关的安装请求
          const isVoiceService = serviceName === 'ASR' || serviceName === 'TTS';
          const voiceContainerName = 'ASR_TTS';
          
          // 如果是语音服务，检查容器是否已经存在
          if (isVoiceService) {
            const existingVoiceContainer = containerInfos.filter(
              (item) => item.Names.indexOf(voiceContainerName) >= 0,
            )[0];
            
            if (existingVoiceContainer) {
              sendInstallLog(event, 'info', serviceName, '检测到语音服务容器已存在，跳过安装');
              sendInstallLog(event, 'success', serviceName, '语音服务容器已就绪');
              event.reply(channel, MESSAGE_TYPE.INFO, '语音服务容器已存在');
              return;
            }
          }
          
          console.debug('install', imageName);
          sendInstallLog(event, 'info', serviceName, '开始准备容器镜像');
          
          try {
            await ensureImageReady(serviceName, event, channel);
            sendInstallLog(event, 'success', serviceName, '容器镜像准备完成');
          } catch (e) {
            sendInstallLog(event, 'error', serviceName, `镜像准备失败: ${e}`);
            event.reply(channel, MESSAGE_TYPE.ERROR, '镜像准备失败');
            return;
          }
          
          sendInstallLog(event, 'info', serviceName, '正在获取容器配置');
          const config = getMergedContainerConfig(serviceName,getContainerConfig())
          sendInstallLog(event, 'info', serviceName, `端口映射配置: ${config.port.map(p => `${p.host}:${p.container}`).join(', ')}`);
          
          let newContainerInfo:
            | {
                Id: string;
                Warnings: string[];
              }
            | undefined;
          
          try {
            sendInstallLog(event, 'info', serviceName, '正在创建容器...');
            newContainerInfo = await improveStablebility(async () => {
              return connectionGlobal.createPodmanContainer({
                image: imageName,
                name: containerName,
                devices: [{ path: 'nvidia.com/gpu=all' }],
                portmappings:config.port.map(p=>({container_port: p.container, host_port: p.host}))
              });
            });
          } catch (e) {
            sendInstallLog(event, 'error', serviceName, `容器创建失败: ${e}`);
            event.reply(channel, MESSAGE_TYPE.ERROR, '容器创建失败');
            return;
          }

          console.debug('newContainerInfo', newContainerInfo);
          if (newContainerInfo) {
            console.debug('安装服务成功');
            sendInstallLog(event, 'success', serviceName, `容器创建成功 (ID: ${newContainerInfo.Id.substring(0, 12)})`);
            
            try {
              sendInstallLog(event, 'info', serviceName, '正在启动容器...');
              await improveStablebility(async () => {
                const newContainer = connectionGlobal.getContainer(
                  newContainerInfo.Id,
                );
                await newContainer.start();
                event.reply(channel, MESSAGE_TYPE.INFO, '成功启动服务');
              });
              sendInstallLog(event, 'success', serviceName, '容器启动成功');
              
              // 容器启动后，自动启动所有服务
              try {
                sendInstallLog(event, 'info', serviceName, '正在启动容器内的AI服务...');
                await commandLine.exec(getPodmanCli(), [
                  'exec',
                  containerName,
                  './start.sh'
                ]);
                sendInstallLog(event, 'success', serviceName, 'AI服务启动成功');
              } catch (e) {
                sendInstallLog(event, 'warning', serviceName, `AI服务启动失败，可以稍后手动启动: ${e}`);
              }
            } catch (e) {
              sendInstallLog(event, 'error', serviceName, `容器启动失败: ${e}`);
            }
            
            sendInstallLog(event, 'success', serviceName, '容器安装完成');
            event.reply(channel, MESSAGE_TYPE.INFO, '安装服务成功');
          } else {
            console.debug('安装服务失败');
            sendInstallLog(event, 'error', serviceName, '容器创建失败，返回信息为空');
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
