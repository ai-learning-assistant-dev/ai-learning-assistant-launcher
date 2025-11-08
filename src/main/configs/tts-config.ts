import { ActionName, ServiceName, ContainerConfig, channel } from './type-info';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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

export { syncTtsConfigToAloud };

// 同步TTS配置到Aloud插件
async function syncTtsConfigToAloud(event: any, channel: string, model: string) {
  try {
    // 获取Obsidian配置路径
    const obsidianConfigPath = '%APPDATA%\\Obsidian\\obsidian.json'.replace(
      '%APPDATA%',
      process.env.APPDATA || ''
    );

    if (!existsSync(obsidianConfigPath)) {
      console.warn('未找到Obsidian配置文件');
      return;
    }

    // 读取Obsidian配置获取所有仓库
    const obsidianConfig = JSON.parse(readFileSync(obsidianConfigPath, 'utf8'));

    if (!obsidianConfig.vaults || Object.keys(obsidianConfig.vaults).length === 0) {
      console.warn('未找到任何Obsidian仓库');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const results: string[] = [];

    // 遍历所有仓库
    for (const vaultId in obsidianConfig.vaults) {
      if (Object.prototype.hasOwnProperty.call(obsidianConfig.vaults, vaultId)) {
        try {
          // 获取仓库名称（使用路径的最后一部分）
          const vaultPath = obsidianConfig.vaults[vaultId].path;
          const pathParts = vaultPath.split(/[/\\]/);
          const vaultName = pathParts[pathParts.length - 1];

          // 为每个仓库同步Aloud插件配置
          await syncSingleAloudConfig(vaultId, obsidianConfig.vaults[vaultId], model);
          successCount++;
          results.push(`仓库 ${vaultName} 同步成功；`);
        } catch (error) {
          const vaultPath = obsidianConfig.vaults[vaultId].path;
          const pathParts = vaultPath.split(/[/\\]/);
          const vaultName = pathParts[pathParts.length - 1];

          failCount++;
          results.push(`仓库 ${vaultName} 同步失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
    }
    
    // 输出同步结果到日志
    // console.log(`TTS配置同步完成: 成功${successCount}个, 失败${failCount}个`);
    results.forEach(result => console.log(result));

    // 发送结果回前端
    event.reply(
      channel, 
      MESSAGE_TYPE.INFO, 
      `批量同步aloud插件配置完成: 成功${successCount}个, 失败${failCount}个；${results.join('\n')}音色选择请到aloud插件中设置。`
    );
    
  } catch (error) {
    console.error('同步TTS配置到aloud插件失败:', error);
  }
}

/**
 * 同步单个仓库中的Aloud插件配置
 */
async function syncSingleAloudConfig(vaultId: string, vault: any, model: string) {
  // 构建插件目录路径
  const pluginsDir = path.join(vault.path, '.obsidian', 'plugins');

  // 检查插件目录是否存在
  if (!existsSync(pluginsDir)) {
    throw new Error('插件目录不存在');
  }

  // 获取所有插件目录
  const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  // 查找id为aloud-tts-ai-learning-assistant的插件
  let targetPluginDir = null;
  for (const pluginDir of pluginDirs) {
    const manifestPath = path.join(pluginsDir, pluginDir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        
        if (manifest.id === 'aloud-tts-ai-learning-assistant') {
          targetPluginDir = pluginDir;
          break;
        }
      } catch (err) {
        console.error(`读取插件 ${pluginDir} 的manifest.json 失败:`, err);
      }
    }
  }
  
  // 如果没有找到目标插件，则跳过
  if (!targetPluginDir) {
    throw new Error('未找到ID为aloud-tts-ai-learning-assistant的插件');
  }
  
  // 构建目标插件data.json路径
  const aloudDataPath = path.join(pluginsDir, targetPluginDir, 'data.json');
  
  let updatedAloudData = {};
  
  // 如果data.json存在，只更新model字段
  if (existsSync(aloudDataPath)) {
    const aloudData = JSON.parse(readFileSync(aloudDataPath, 'utf8'));
    updatedAloudData = {
      ...aloudData,
      model: model
    };
  } else {
    // 如果data.json不存在，创建完整配置
    updatedAloudData = {
      OPENAI_API_KEY: "",
      OPENAI_API_URL: "http://localhost:8000",
      modelProvider: "openaicompat",
      model: model,
      ttsVoice: "alloy",
      chunkType: "sentence",
      playbackSpeed: 1,
      cacheDurationMillis: 604800000,
      cacheType: "local",
      showPlayerView: "always-mobile",
      openai_apiKey: "",
      openai_ttsModel: "gpt-4o-mini-tts",
      openai_ttsVoice: "shimmer",
      openaicompat_apiKey: "123",
      openaicompat_apiBase: "",
      openaicompat_ttsModel: "",
      openaicompat_ttsVoice: "",
      version: 1,
      audioFolder: "aloud",
      customVoices: []
    };
  }
  
  // 保存更新后的配置
  writeFileSync(aloudDataPath, JSON.stringify(updatedAloudData, null, 2), {
    encoding: 'utf8',
  });
  
  // console.log(`成功同步TTS配置到仓库 ${vaultId} 的aloud插件`);
}

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
      // 确定使用的模型
      let model = "";
      if (forceNvidia) {
        containerConfig.TTS.env.TTS_MODELS = 'index-tts';
        containerConfig.TTS.env.USE_GPU = 'true';
        model = 'index-tts';
      } else if (forceCPU) {
        containerConfig.TTS.env.TTS_MODELS = 'kokoro';
        containerConfig.TTS.env.USE_GPU = 'false';
        model = 'kokoro';
      } else {
        delete containerConfig.TTS.env.TTS_MODELS;
        containerConfig.TTS.env.USE_GPU = 'false';
        model = 'kokoro'; // 默认模型
      }

      // 写回配置文件
      writeFileSync(
        containerConfigPath,
        JSON.stringify(containerConfig, null, 2),
        {
          encoding: 'utf8',
        },
      );

      // 同步配置到aloud插件
      await syncTtsConfigToAloud(event, channel, model);

      console.debug('TTS config updated successfully');
      event.reply(
        channel,
        MESSAGE_TYPE.PROGRESS,
        'TTS模型选择已更新，正在重建TTS服务',
      );
      await removeContainer('TTS');
      const container = await createContainer('TTS');
      event.reply(
        channel,
        MESSAGE_TYPE.INFO,
        'TTS服务更新成功，你可以返回上一页启动服务',
      );
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
