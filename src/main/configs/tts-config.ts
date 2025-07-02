import { ActionName, ServiceName, ContainerConfig, channel } from './type-info';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath } from '../exec';
import { MESSAGE_TYPE } from '../ipc-data-type';
import {
  createContainer,
  removeContainer,
  startContainer,
} from '../podman-desktop/simple-container-manage';

const containerConfigPath = path.join(
  appPath,
  'external-resources',
  'ai-assistant-backend',
  'container-config.json',
);

export async function ttsConfig(
  event: Electron.IpcMainEvent,
  action: ActionName,
  serviceName: ServiceName,
  extraData?: any,
) {
  try {
    console.debug('ttsConfig called with:', { action, serviceName, extraData });

    if (action === 'update' && serviceName === 'container') {
      const { forceNvidia, forceCPU } = extraData;
      console.debug('Updating TTS config:', { forceNvidia, forceCPU });

      // 检查配置文件路径是否存在
      console.debug('Container config path:', containerConfigPath);

      // 读取当前配置
      const containerConfigString = readFileSync(containerConfigPath, {
        encoding: 'utf8',
      });
      const containerConfig = JSON.parse(
        containerConfigString,
      ) as ContainerConfig;

      // 更新TTS的GPU配置
      if (!containerConfig.TTS.gpuConfig) {
        containerConfig.TTS.gpuConfig = { forceNvidia: false, forceCPU: false };
      }

      containerConfig.TTS.gpuConfig.forceNvidia = forceNvidia;
      containerConfig.TTS.gpuConfig.forceCPU = forceCPU;
      if (forceNvidia) {
        containerConfig.TTS.env.TTS_MODELS = 'index-tts';
      } else if (forceCPU) {
        containerConfig.TTS.env.TTS_MODELS = 'kokoro';
      } else {
        delete containerConfig.TTS.env.TTS_MODELS;
      }

      // 写回配置文件
      writeFileSync(
        containerConfigPath,
        JSON.stringify(containerConfig, null, 2),
        {
          encoding: 'utf8',
        },
      );

      console.debug('TTS config updated successfully');
      event.reply(
        channel,
        MESSAGE_TYPE.PROGRESS,
        'TTS模型选择已更新，正在重启TTS服务',
      );
      await removeContainer('TTS');
      const container = await createContainer('TTS');
      await startContainer(container.Id);
      event.reply(channel, MESSAGE_TYPE.INFO, 'TTS服务已启动');
    }
  } catch (error) {
    console.error('Error in ttsConfig:', error);
    event.reply(
      channel,
      MESSAGE_TYPE.ERROR,
      `TTS模型选择更新失败: ${error.message}`,
    );
  }

  return true;
}
