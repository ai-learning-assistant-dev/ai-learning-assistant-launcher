import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
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

// 临时文件操作记录
interface FileOperation {
  type: 'add' | 'delete';
  filename: string;
  originalPath?: string; // 添加时记录原始路径
}

// 全局临时文件操作记录
let tempFileOperations: FileOperation[] = [];
let tempFileList: Map<string, string> = new Map(); // filename -> realPath

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
            // 处理语音配置保存，包括文件操作
            await handleVoiceConfigSave(event, extraData);
          }
        } else if (action === 'selectVoiceFile') {
          if (serviceName === 'TTS') {
            // 选择语音文件，但不立即复制
            const modelType = extraData.modelType || 'gpu';
            
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
                
                // 检查是否已存在同名文件
                if (tempFileList.has(fileName)) {
                  event.reply(channel, MESSAGE_TYPE.ERROR, `文件名 "${fileName}" 已存在，请选择其他文件`);
                  return;
                }
                
                // 记录添加操作
                tempFileOperations.push({
                  type: 'add',
                  filename: fileName,
                  originalPath: selectedFilePath
                });
                
                // 更新临时文件列表
                tempFileList.set(fileName, selectedFilePath);
                
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
        } else if (action === 'initVoiceFileList') {
          if (serviceName === 'TTS') {
            // 初始化语音文件列表
            const modelType = extraData.modelType || 'gpu';
            await initVoiceFileList(event, modelType);
          }
        } else if (action === 'deleteVoiceFile') {
          if (serviceName === 'TTS') {
            // 记录删除文件操作
            const filename = extraData.filename;
            if (tempFileList.has(filename)) {
              tempFileOperations.push({
                type: 'delete',
                filename: filename
              });
              
              // 从临时文件列表中移除
              tempFileList.delete(filename);
              
              event.reply(channel, MESSAGE_TYPE.INFO, `已记录删除文件 "${filename}" 的操作`);
            } else {
              event.reply(channel, MESSAGE_TYPE.ERROR, `文件 "${filename}" 不存在`);
            }
          }
        }
      }
    },
  );
}

// 初始化语音文件列表
async function initVoiceFileList(event: any, modelType: 'gpu' | 'cpu') {
  try {
    const voicesFolderPath = path.join(
      appPath,
      'external-resources',
      'ai-assistant-backend',
      modelType === 'gpu' ? 'index-tts' : 'kokoro',
      'voices',
    );
    
    // 清空临时状态
    tempFileOperations = [];
    tempFileList.clear();
    
    // 读取文件夹中的所有文件
    if (existsSync(voicesFolderPath)) {
      const files = readdirSync(voicesFolderPath);
      const fileExtensions = modelType === 'gpu' ? ['.wav'] : ['.pt'];
      
      files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        if (fileExtensions.includes(ext)) {
          const filePath = path.join(voicesFolderPath, file);
          tempFileList.set(file, filePath);
        }
      });
    }
    
    // 返回文件列表给前端
    const fileList = Array.from(tempFileList.keys());
    event.reply(
      channel,
      MESSAGE_TYPE.DATA,
      new MessageData('initVoiceFileList', 'TTS', { fileList })
    );
    
  } catch (error) {
    console.error('Error initializing voice file list:', error);
    event.reply(channel, MESSAGE_TYPE.ERROR, '初始化语音文件列表失败');
  }
}

// 处理语音配置保存，包括文件操作
async function handleVoiceConfigSave(event: any, extraData: any) {
  try {
    const modelType = extraData.modelType || 'gpu';
    const voicesFolderPath = path.join(
      appPath,
      'external-resources',
      'ai-assistant-backend',
      modelType === 'gpu' ? 'index-tts' : 'kokoro',
      'voices',
    );
    
    // 执行文件操作
    for (const operation of tempFileOperations) {
      if (operation.type === 'add' && operation.originalPath) {
        const targetFilePath = path.join(voicesFolderPath, operation.filename);
        
        // 检查目标文件是否已存在
        if (existsSync(targetFilePath)) {
          event.reply(channel, MESSAGE_TYPE.ERROR, `文件 "${operation.filename}" 已存在于目标文件夹中`);
          return;
        }
        
        // 复制文件
        copyFileSync(operation.originalPath, targetFilePath);
        console.log(`Copied file: ${operation.originalPath} -> ${targetFilePath}`);
        
      } else if (operation.type === 'delete') {
        const targetFilePath = path.join(voicesFolderPath, operation.filename);
        
        // 检查文件是否存在
        if (existsSync(targetFilePath)) {
          // 删除文件
          unlinkSync(targetFilePath);
          console.log(`Deleted file: ${targetFilePath}`);
        }
      }
    }
    
    // 保存语音配置
    setVoiceConfig(extraData.config, modelType);
    
    // 清空临时操作记录
    tempFileOperations = [];
    
    event.reply(channel, MESSAGE_TYPE.INFO, '语音配置和文件操作已保存');
    
  } catch (error) {
    console.error('Error saving voice config:', error);
    event.reply(channel, MESSAGE_TYPE.ERROR, '保存语音配置失败');
  }
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
