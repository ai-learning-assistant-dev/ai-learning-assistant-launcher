import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
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
  PdfConfig,
  LLMConfig,
  CustomModel
} from './type-info';
import { isWindows } from '../exec/util';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { ttsConfig } from './tts-config';
import { ChatOpenAI, OpenAIEmbeddings} from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI  } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { ChatDeepSeek } from '@langchain/deepseek';

// 临时文件操作记录
interface FileOperation {
  type: 'add' | 'delete';
  filename: string;
  originalPath?: string; // 添加时记录原始路径
}

// 全局临时文件操作记录
let tempFileOperations: FileOperation[] = [];
let tempFileList: Map<string, string> = new Map(); // filename -> realPath

// PDF配置默认值
const defaultPdfConfig: PdfConfig = {
  start_page_id: 0,
  end_page_id: 99999,
  table_enable: true,
  formula_enable: true,
};

// 内存中的PDF配置存储
let currentPdfConfig: PdfConfig = { ...defaultPdfConfig };

// 添加默认的大模型配置
const defaultLlmConfig: LLMConfig = {
  models: [],
};

// 添加大模型配置文件路径
const llmConfigPath = path.join(
  appPath,
  'external-resources',
  'config',
  'llm-config.json',
);

// 内存中的大模型配置存储
let currentLlmConfig: LLMConfig = { ...defaultLlmConfig };

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
          } else if (serviceName === 'PDF') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, currentPdfConfig),
            );
          } else if (serviceName === 'LLM') {
            getLlmConfig();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, currentLlmConfig),
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
              } else if (result.canceled) {
                // 用户取消选择，发送取消响应给前端
                event.reply(
                  channel,
                  MESSAGE_TYPE.DATA,
                  new MessageData(action, serviceName, { canceled: true })
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
        } else if (action === 'get') {
          if (serviceName === 'PDF') {
            // 获取PDF配置
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, currentPdfConfig),
            );
          }
        } else if (action === 'set') {
          if (serviceName === 'PDF') {
            // 设置PDF配置
            try {
              if (extraData) {
                const validatedConfig = validatePdfConfig(extraData);
                currentPdfConfig = { ...validatedConfig };
                
                event.reply(
                  channel,
                  MESSAGE_TYPE.DATA,
                  new MessageData(action, serviceName, currentPdfConfig),
                );
                
                console.log('PDF配置已更新:', currentPdfConfig);
              } else {
                event.reply(channel, MESSAGE_TYPE.ERROR, '无效的配置数据');
              }
            } catch (error) {
              console.error('PDF配置处理失败:', error);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                `配置处理失败: ${error instanceof Error ? error.message : '未知错误'}`,
              );
            }
          } else if (serviceName === 'LLM') {
            try {
              // 更新大模型配置
              if (extraData) {
                currentLlmConfig = { ...extraData };
                saveLlmConfig(currentLlmConfig);
                event.reply(
                  channel,
                  MESSAGE_TYPE.INFO,
                  '大模型配置已保存'
                );
              } else {
                event.reply(channel, MESSAGE_TYPE.ERROR, '无效的配置数据');
              }
            } catch (error) {
              console.error('保存大模型配置失败:', error);
              event.reply(channel, MESSAGE_TYPE.ERROR, '保存大模型配置失败');
            }
          }
        } else if (action === 'testConnection') {
          if (serviceName === 'LLM') {
            try {
              // 测试模型连接
              const model: CustomModel = extraData;
              const result = await testModelConnection(model);
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, result),
              );
            } catch (error) {
              console.error('测试连接失败:', error);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                `测试连接失败: ${error instanceof Error ? error.message : '未知错误'}`
              );
            }
          }
        } else if (action === 'syncAllApiKeys') {
          // 新增处理批量同步所有API key的逻辑
          if (serviceName === 'copilot') {
            const { llmConfig } = extraData;
            await syncAllCopilotApiKeys(event, llmConfig);
          }
        }
      }
    },
  );
}

// 添加保存大模型配置的函数
function saveLlmConfig(config: LLMConfig) {
  try {
    writeFileSync(llmConfigPath, JSON.stringify(config, null, 2), {
      encoding: 'utf8',
    });
  } catch (error) {
    console.error('保存大模型配置文件失败:', error);
  }
}

// 添加获取大模型配置的函数
export function getLlmConfig(): LLMConfig {
  try {
    if (existsSync(llmConfigPath)) {
      const configString = readFileSync(llmConfigPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as LLMConfig;
      currentLlmConfig = { ...config };
    }
    return currentLlmConfig;
  } catch (error) {
    console.error('读取大模型配置失败:', error);
    return { ...defaultLlmConfig };
  }
}

// 添加测试模型连接的函
async function testModelConnection(model: CustomModel): Promise<{success: boolean, message: string}> {
  try {
    let response: any;
    
    // 如果是嵌入模型，使用不同的测试方法
    if (model.isEmbeddingModel) {
      switch (model.provider.toLowerCase()) {
        case 'openai':
        case 'azure openai':
          const openaiEmbeddings = new OpenAIEmbeddings({
            openAIApiKey: model.apiKey,
            model: model.name,
            configuration: {
              baseURL: model.baseUrl
            }
          });
          response = await openaiEmbeddings.embedQuery("Hello world");
          break;
          
        case 'anthropic':
        case 'google':
        case 'ollama':
        case 'deepseek':
        case 'lm-studio':
        case '3rd party (openai-format)':
        default:
          // 对于其他提供商，尝试通用的 OpenAI 格式
          const genericEmbeddings = new OpenAIEmbeddings({
            apiKey: model.apiKey,
            model: model.name,
            configuration: {
              baseURL: model.baseUrl
            }
          });
          response = await genericEmbeddings.embedQuery("Hello world");
          break;
      }
      console.log("response:", response);
      // 检查嵌入响应是否有效
      if (response && Array.isArray(response) && response.length > 0) {
        return { success: true, message: "嵌入模型连接测试成功" };
      } else {
        return { success: false, message: "嵌入模型返回无效响应" };
      }
    } else {
      switch (model.provider.toLowerCase()) {
        case 'openai':
        case 'azure openai':
          const openai = new ChatOpenAI({
            apiKey: model.apiKey,
            model: model.name,
            configuration: {
              baseURL: model.baseUrl
            }
          });
          response = await openai.invoke("hello");
          break;
          
        case 'anthropic':
          const anthropic = new ChatAnthropic({
            anthropicApiKey: model.apiKey,
            model: model.name,
            anthropicApiUrl: model.baseUrl
          });
          response = await anthropic.invoke("hello");
          break;
          
        case 'google':
          const google = new ChatGoogleGenerativeAI({
            apiKey: model.apiKey,
            model: model.name
          });
          response = await google.invoke("hello");
          break;
          
        case 'ollama':
          const ollama = new ChatOllama({
            baseUrl: model.baseUrl,
            model: model.name
          });
          response = await ollama.invoke("hello");
          break;
        
        case 'deepseek':
          const deepseek = new ChatDeepSeek({
            apiKey: model.apiKey,
            model: model.name,
            configuration: {
              baseURL: model.baseUrl
            }
          });
          response = await deepseek.invoke("hello");
          break;
        
        case 'lm-studio':
        case '3rd party (openai-format)':
        default:
          // 对于其他提供商，尝试通用的 OpenAI 格式
          const generic = new ChatOpenAI({
            apiKey: model.apiKey,
            model: model.name,
            temperature: 0,
            maxTokens: undefined,
            timeout: undefined,
            maxRetries: 2,
            configuration: {
              baseURL: model.baseUrl
            }
          });
          response = await generic.invoke("hello");
          break;
      }
      console.log("response:", response);
      // 检查响应是否有效
      if (response && (typeof response.content === 'string' || Array.isArray(response.content))) {
        return { success: true, message: "连接测试成功" };
      } else {
        return { success: false, message: "模型返回无效响应" };
      }
    }
  } catch (error) {
    console.error(`测试模型连接失败 (${model.provider}):`, error);
    
    // 提供更友好的错误信息
    let errorMessage = "未知错误";
    if (error instanceof Error) {
      if (error.message.includes("timeout")) {
        errorMessage = "连接超时，请检查网络或API端点";
      } else if (error.message.includes("401") || error.message.includes("Unauthorized")) {
        errorMessage = "认证失败，请检查API密钥";
      } else if (error.message.includes("404")) {
        errorMessage = "未找到指定模型，请检查模型名称";
      } else if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
        errorMessage = "无法连接到服务器，请检查API端点URL";
      } else {
        errorMessage = error.message;
      }
    }
    
    return { success: false, message: errorMessage };
  }
}

/**
 * 批量同步所有仓库中的Copilot插件API密钥
 */
async function syncAllCopilotApiKeys(event: any, llmConfig: LLMConfig) {
  try {
    // 获取Obsidian配置路径
    const obsidianConfigPath = '%APPDATA%\\Obsidian\\obsidian.json'.replace(
      '%APPDATA%',
      process.env.APPDATA || ''
    );
    
    if (!existsSync(obsidianConfigPath)) {
      throw new Error('未找到Obsidian配置文件');
    }
    
    // 读取Obsidian配置获取所有仓库
    const obsidianConfig = JSON.parse(readFileSync(obsidianConfigPath, 'utf8'));
    
    // 添加调试信息输出
    // console.log('Obsidian配置信息:', JSON.stringify(obsidianConfig, null, 2));

    if (!obsidianConfig.vaults || Object.keys(obsidianConfig.vaults).length === 0) {
      throw new Error('未找到任何Obsidian仓库');
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

          // 为每个仓库同步Copilot插件API密钥
          await syncSingleCopilotApiKey(vaultId, obsidianConfig.vaults[vaultId], llmConfig);
          successCount++;
          results.push(`仓库 ${vaultName} 同步成功`);
        } catch (error) {
          const vaultPath = obsidianConfig.vaults[vaultId].path;
          const pathParts = vaultPath.split(/[/\\]/);
          const vaultName = pathParts[pathParts.length - 1];

          failCount++;
          results.push(`仓库 ${vaultName} 同步失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      }
    }
    
    // 发送结果回前端
    event.reply(
      channel, 
      MESSAGE_TYPE.INFO, 
      `批量同步完成: 成功${successCount}个, 失败${failCount}个\n${results.join('\n')}`
    );
    
  } catch (error) {
    console.error('批量同步API key失败:', error);
    event.reply(
      channel, 
      MESSAGE_TYPE.ERROR, 
      `批量同步API key失败: ${error instanceof Error ? error.message : '未知错误'}`
    );
  }
}

/**
 * 同步单个仓库中的Copilot插件API密钥
 */
async function syncSingleCopilotApiKey(vaultId: string, vault: any, llmConfig: LLMConfig) {
  // console.log(`处理仓库 ${vaultId}:`, JSON.stringify(vault, null, 2));
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
  
  // console.log(`仓库 ${vaultId} 中的插件列表:`, pluginDirs);
  
  // 查找id为copilot-ai-learning-assistant的插件
  let targetPluginDir = null;
  for (const pluginDir of pluginDirs) {
    const manifestPath = path.join(pluginsDir, pluginDir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        // console.log(`插件 ${pluginDir} 的manifest信息:`, JSON.stringify(manifest, null, 2));
        
        if (manifest.id === 'copilot-ai-learning-assistant') {
          targetPluginDir = pluginDir;
          break;
        }
      } catch (err) {
        console.error(`读取插件 ${pluginDir} 的manifest.json 失败:`, err);
      }
    }
  }
  
  // 如果没有找到目标插件
  if (!targetPluginDir) {
    throw new Error('未找到ID为copilot-ai-learning-assistant的插件');
  }
  
  // console.log(`找到目标插件: ${targetPluginDir}`);
  
  // 构建目标插件data.json路径
  const copilotDataPath = path.join(pluginsDir, targetPluginDir, 'data.json');
  // console.log(`Copilot配置文件路径: ${copilotDataPath}`);
  
  // 检查data.json是否存在
  if (!existsSync(copilotDataPath)) {
    throw new Error('插件无data.json配置文件');
  }
  
  // 读取现有的data.json
  const copilotData = JSON.parse(readFileSync(copilotDataPath, 'utf8'));
  // console.log('原始Copilot配置:', JSON.stringify(copilotData, null, 2));
  
  // console.log('当前大模型配置:', JSON.stringify(llmConfig, null, 2));
  
  // 后续的同步参数步骤将在您说明后添加
  // 同步模型配置
  syncModelConfigurations(copilotData, llmConfig);
  
  // 保存更新后的配置
  writeFileSync(copilotDataPath, JSON.stringify(copilotData, null, 2), {
    encoding: 'utf8',
  });
  
  // console.log('更新后的Copilot配置:', JSON.stringify(copilotData, null, 2));
}

/**
 * 同步模型配置到Copilot数据
 */
function syncModelConfigurations(copilotData: any, llmConfig: LLMConfig) {
  // 确保activeModels存在
  if (!copilotData.activeModels) {
    copilotData.activeModels = [];
  }

  if (!copilotData.activeEmbeddingModels) {
    copilotData.activeEmbeddingModels = [];
  }
  
  // 创建一个映射以便快速查找activeModels中的现有模型
  const activeModelMap = new Map<string, number>();
  copilotData.activeModels.forEach((model: any, index: number) => {
    const key = `${model.provider}-${model.name}`;
    activeModelMap.set(key, index);
  });

  // 创建映射以便快速查找activeEmbeddingModels中的现有模型
  const activeEmbeddingModelMap = new Map<string, number>();
  copilotData.activeEmbeddingModels.forEach((model: any, index: number) => {
    const key = `${model.provider}-${model.name}`;
    activeEmbeddingModelMap.set(key, index);
  });

  // 分离语言模型和嵌入模型
  const languageModels = llmConfig.models.filter(model => !model.isEmbeddingModel);
  const embeddingModels = llmConfig.models.filter(model => model.isEmbeddingModel);
  
  // 处理大语言模型
  languageModels.forEach(model => {
    const key = `${model.provider}-${model.name}`;
    const existingModelIndex = activeModelMap.get(key);
    
    if (existingModelIndex !== undefined) {
      // 如果找到了现有模型，只更新指定的字段
      copilotData.activeModels[existingModelIndex].baseUrl = model.baseUrl || "";
      copilotData.activeModels[existingModelIndex].apiKey = model.apiKey || "";
      copilotData.activeModels[existingModelIndex].displayName = model.displayName || model.name;
    } else {
      // 如果没找到现有模型，添加新模型
      const modelConfig = {
        name: model.name,
        provider: model.provider,
        enabled: true,
        isBuiltIn: false,
        baseUrl: model.baseUrl || "",
        apiKey: model.apiKey || "",
        isEmbeddingModel: false,
        capabilities: [],
        stream: true,
        displayName: model.displayName || model.name
      };
      copilotData.activeModels.push(modelConfig);
    }
  });
  
  // 处理嵌入模型
  embeddingModels.forEach(model => {
    const key = `${model.provider}-${model.name}`;
    const existingModelIndex = activeEmbeddingModelMap.get(key);
    
    if (existingModelIndex !== undefined) {
      // 如果找到了现有模型，只更新指定的字段
      copilotData.activeEmbeddingModels[existingModelIndex].baseUrl = model.baseUrl || "";
      copilotData.activeEmbeddingModels[existingModelIndex].apiKey = model.apiKey || "";
      copilotData.activeEmbeddingModels[existingModelIndex].displayName = model.displayName || model.name;
    } else {
      // 如果没找到现有模型，添加新模型
      const modelConfig = {
        name: model.name,
        provider: model.provider,
        enabled: true,
        isBuiltIn: false,
        baseUrl: model.baseUrl || "",
        apiKey: model.apiKey || "",
        isEmbeddingModel: true,
        capabilities: [],
        displayName: model.displayName || model.name
      };
      copilotData.activeEmbeddingModels.push(modelConfig);
    }
  });
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
  PDF: { port: [], command: { start: [], stop: [] } },
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
      const p = path.parse(config.vaults[key].path);
      vaults.push({
        id: key,
        name: p.base,
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

// 验证PDF配置数据
function validatePdfConfig(config: Partial<PdfConfig>): PdfConfig {
  const validated: PdfConfig = {
    start_page_id: Math.max(0, Math.min(99999, config.start_page_id ?? defaultPdfConfig.start_page_id)),
    end_page_id: Math.max(0, Math.min(99999, config.end_page_id ?? defaultPdfConfig.end_page_id)),
    table_enable: config.table_enable ?? defaultPdfConfig.table_enable,
    formula_enable: config.formula_enable ?? defaultPdfConfig.formula_enable,
  };

  // 确保结束页码不小于起始页码
  if (validated.end_page_id < validated.start_page_id) {
    validated.end_page_id = validated.start_page_id;
  }

  return validated;
}

// 导出获取当前PDF配置的函数，供其他模块使用
export function getCurrentPdfConfig(): PdfConfig {
  return { ...currentPdfConfig };
}
