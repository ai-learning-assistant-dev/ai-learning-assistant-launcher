import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { appPath } from '../exec';
import { dialog, IpcMain, shell } from 'electron';
import {
  ActionName,
  channel,
  ContainerConfig,
  ObsidianConfig,
  ObsidianVaultConfig,
  ServiceName,
  VoiceConfigFile,
} from './type-info';
import { isWindows } from '../exec/util';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { ttsConfig } from './tts-config';

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (
      event,
      action: ActionName,
      serviceName: ServiceName,
      extraData?: any,
    ) => {
      console.debug(
        `configs action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      if (isWindows()) {
        if (action === 'query') {
          if (serviceName === 'obsidianApp') {
            console.debug('obsidianApp');
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, getObsidianConfig()),
            );
          } else if (serviceName === 'obsidianVault') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, getObsidianVaultConfig()),
            );
          } else if (serviceName === 'container') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, getContainerConfig()),
            );
          } else if (serviceName === 'TTS') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(
                action,
                serviceName,
                getVoiceConfig(extraData?.modelType || 'gpu'),
              ),
            );
          }
        } else if (action === 'update') {
          if (serviceName === 'obsidianApp') {
            const result = await dialog.showOpenDialog({
              properties: ['openFile', 'showHiddenFiles'],
            });
            const path = result.filePaths[0];
            if (path && path.length > 0) {
              const obsidianConfig = getObsidianConfig();
              obsidianConfig.obsidianApp.bin = path;
              setObsidianConfig(obsidianConfig);
              event.reply(channel, MESSAGE_TYPE.INFO, '成功设置Obsidian路径');
            } else {
              event.reply(channel, MESSAGE_TYPE.INFO, '没有设置好Obsidian路径');
            }
          } else if (serviceName === 'container') {
            if (extraData.containerName === 'TTS') {
              await ttsConfig(event, action, serviceName, extraData);
            }
            // 修改配置
          } else if (serviceName === 'TTS') {
            setVoiceConfig(extraData.config, extraData.modelType || 'gpu');
            event.reply(channel, MESSAGE_TYPE.INFO, '语音配置已保存');
          }
        } else if (action === 'selectVoiceFile') {
          if (serviceName === 'TTS') {
            // 选择语音文件
            const modelType = extraData.modelType || 'gpu';
            const voicesFolderPath = path.join(
              appPath,
              'external-resources',
              'ai-assistant-backend',
              modelType === 'gpu' ? 'index-tts' : 'kokoro',
              'voices',
            );
            
            try {
              // 显示文件选择对话框
              const result = await dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [
                  { name: '语音文件', extensions: modelType === 'gpu' ? ['wav'] : ['pt'] },
                  { name: '所有文件', extensions: ['*'] }
                ],
                title: '选择语音文件'
              });
              
              if (!result.canceled && result.filePaths.length > 0) {
                const selectedFilePath = result.filePaths[0];
                const fileName = path.basename(selectedFilePath);
                const targetFilePath = path.join(voicesFolderPath, fileName);
                
                // 检查选择的文件是否已经在目标文件夹中
                if (selectedFilePath === targetFilePath) {
                    // 文件已经在目标文件夹中，直接返回文件名
                    event.reply(
                      channel,
                      MESSAGE_TYPE.DATA,
                      new MessageData(action, serviceName, { filename: fileName })
                    );
                    return;
                }

                // 检查目标文件夹中是否已存在同名文件
                if (existsSync(targetFilePath)) {
                    event.reply(channel, MESSAGE_TYPE.ERROR, `同名文件已存在于目标文件夹中，请修改文件名`);
                  return;
                }
                
                // 复制文件到目标文件夹
                copyFileSync(selectedFilePath, targetFilePath);
                
                // 返回文件名给前端
                event.reply(
                  channel,
                  MESSAGE_TYPE.DATA,
                  new MessageData(action, serviceName, { filename: fileName })
                );
              }
            } catch (error) {
              console.error('Error selecting voice file:', error);
              event.reply(channel, MESSAGE_TYPE.ERROR, '选择语音文件失败');
            }
          }
        }
      }
    },
  );
}

const containerConfigPath = path.join(
  appPath,
  'external-resources',
  'ai-assistant-backend',
  'container-config.json',
);

let containerConfigBuff: ContainerConfig = {
  ASR: { port: [], command: { start: [], stop: [] } },
  TTS: {
    port: [],
    command: { start: [], stop: [] },
    gpuConfig: { forceNvidia: false, forceCPU: false },
    mounts: [
      {
        Destination: 'Destination',
        Source: 'Source',
        Propagation: 'rprivate',
        Type: 'bind',
        RW: true,
        Options: ['rbind'],
      },
    ],
  },
  LLM: { port: [], command: { start: [], stop: [] } },
};
export function getContainerConfig() {
  const containerConfigString = readFileSync(containerConfigPath, {
    encoding: 'utf8',
  });
  const containerConfig = JSON.parse(containerConfigString) as ContainerConfig;
  if (containerConfig) {
    containerConfigBuff = containerConfig;
  }

  // 确保TTS配置包含gpuConfig
  if (containerConfig && containerConfig.TTS && !containerConfig.TTS.gpuConfig) {
    containerConfig.TTS.gpuConfig = { forceNvidia: false, forceCPU: false };
  }

  return containerConfig;
}

const obsidianConfigPath = path.join(
  appPath,
  'external-resources',
  'config',
  'obsidian-config.json',
);

let obsidianConfigBuff: ObsidianConfig = {
  obsidianApp: {
    bin: 'C:/a/b/c',
  },
};
export function getObsidianConfig() {
  const obsidianConfigPathString = readFileSync(obsidianConfigPath, {
    encoding: 'utf8',
  });
  const obsidianConfig = JSON.parse(obsidianConfigPathString) as ObsidianConfig;
  if (obsidianConfig) {
    obsidianConfigBuff = obsidianConfig;
  }
  return obsidianConfig;
}

export function setObsidianConfig(config) {
  writeFileSync(obsidianConfigPath, JSON.stringify(config, null, 2), {
    encoding: 'utf8',
  });
}

const obsidianVaultRawConfigExample = {
  vaults: {
    d9d365ba15702e08: {
      path: 'D:\\my-electron-app-win32-x64-1.0.0\\external-resources\\user-workspace\\my-docs',
      ts: 1750931357143,
      open: true,
    },
    '84cf481186ed4dcd': {
      path: 'D:\\my-electron-app-win32-x64-1.0.0\\external-resources\\user-workspace\\t2\\t2',
      ts: 1750931352511,
    },
  },
};

export function getObsidianVaultConfig() {
  const config: typeof obsidianVaultRawConfigExample = JSON.parse(
    readFileSync(
      '%APPDATA%\\Obsidian\\obsidian.json'.replace(
        '%APPDATA%',
        process.env.APPDATA,
      ),
      { encoding: 'utf8' },
    ),
  );
  const vaults: ObsidianVaultConfig[] = [];
  for (const key in config.vaults) {
    if (Object.prototype.hasOwnProperty.call(config.vaults, key)) {
      vaults.push({
        id: key,
        name: path.parse(config.vaults[key].path).name,
        path: config.vaults[key].path,
      });
    }
  }
  return vaults;
}

export function setVaultDefaultOpen(vaultId: string) {
  const obsidianConfigPath = '%APPDATA%\\Obsidian\\obsidian.json'.replace(
    '%APPDATA%',
    process.env.APPDATA,
  );
  const config: typeof obsidianVaultRawConfigExample = JSON.parse(
    readFileSync(obsidianConfigPath, { encoding: 'utf8' }),
  );
  for (const key in config.vaults) {
    if (Object.prototype.hasOwnProperty.call(config.vaults, key)) {
      if (key === vaultId) {
        config.vaults[key].open = true;
      } else {
        delete config.vaults[key].open;
      }
    }
  }
  writeFileSync(obsidianConfigPath, JSON.stringify(config), {
    encoding: 'utf8',
  });
  console.debug(
    'write file success',
    obsidianConfigPath,
    JSON.stringify(config),
  );
}

// GPU语音配置文件路径
const ttsGPUVoiceConfigPath = path.join(
  appPath,
  'external-resources',
  'ai-assistant-backend',
  'index-tts',
  'voices',
  'voice_config.json',
);

// CPU语音配置文件路径
const ttsKokoroVoiceConfigPath = path.join(
  appPath,
  'external-resources',
  'ai-assistant-backend',
  'kokoro',
  'voices',
  'voice_config.json',
);

export function getVoiceConfig(modelType: 'gpu' | 'cpu' = 'gpu'): VoiceConfigFile {
  try {
    const configPath = modelType === 'gpu' ? ttsGPUVoiceConfigPath : ttsKokoroVoiceConfigPath;
    const voiceConfigString = readFileSync(configPath, {
      encoding: 'utf8',
    });
    return JSON.parse(voiceConfigString) as VoiceConfigFile;
  } catch (error) {
    console.error('Error reading voice config:', error);
    return { voices: [] };
  }
}

export function setVoiceConfig(config: VoiceConfigFile, modelType: 'gpu' | 'cpu' = 'gpu') {
  const configPath = modelType === 'gpu' ? ttsGPUVoiceConfigPath : ttsKokoroVoiceConfigPath;
  writeFileSync(configPath, JSON.stringify(config, null, 2), {
    encoding: 'utf8',
  });
}
