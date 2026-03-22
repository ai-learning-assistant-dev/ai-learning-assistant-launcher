import { IpcMain } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ipcHandle } from '../ipc-util';
import {
  queryNativeTrainingConfigHandle,
  setNativeTrainingConfigHandle,
  TrainingConfig,
} from './type-info';
import { appPath } from '../exec';

// Training 配置文件路径
const trainingConfigPath = path.join(
  appPath,
  'external-resources',
  'config',
  'training-config.json',
);

// 默认的 Training 配置
const defaultTrainingConfig: TrainingConfig = {
  env: {
    UNLOCK_ALL_SECTION: false,
  },
};

// 内存中的 Training 配置缓存
let currentTrainingConfig: TrainingConfig = { ...defaultTrainingConfig };

export async function initTrainingConfig(ipcMain: IpcMain) {
  // 初始化时加载配置
  loadTrainingConfig();

  ipcHandle(ipcMain, queryNativeTrainingConfigHandle, async (_event) =>
    queryTrainingConfig(),
  );
  ipcHandle(
    ipcMain,
    setNativeTrainingConfigHandle,
    async (_event, config: TrainingConfig) => setTrainingConfig(config),
  );
}

/**
 * 从文件加载 Training 配置
 */
function loadTrainingConfig(): void {
  try {
    if (existsSync(trainingConfigPath)) {
      const configString = readFileSync(trainingConfigPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as TrainingConfig;
      currentTrainingConfig = { ...defaultTrainingConfig, ...config };
    } else {
      // 配置文件不存在，创建默认配置文件
      saveTrainingConfig(defaultTrainingConfig);
    }
  } catch (error) {
    console.error('读取 Training 配置失败:', error);
    currentTrainingConfig = { ...defaultTrainingConfig };
  }
}

/**
 * 保存 Training 配置到文件
 */
function saveTrainingConfig(config: TrainingConfig): void {
  try {
    // 确保配置目录存在
    const configDir = path.dirname(trainingConfigPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    writeFileSync(trainingConfigPath, JSON.stringify(config, null, 2), {
      encoding: 'utf8',
    });
  } catch (error) {
    console.error('保存 Training 配置文件失败:', error);
  }
}

/**
 * 查询 Training 配置
 */
export async function queryTrainingConfig(): Promise<TrainingConfig> {
  loadTrainingConfig();
  return { ...currentTrainingConfig };
}

/**
 * 设置 Training 配置
 */
export async function setTrainingConfig(
  config: TrainingConfig,
): Promise<TrainingConfig> {
  // 合并配置，保留未指定的默认值
  currentTrainingConfig = {
    ...defaultTrainingConfig,
    ...config,
    env: {
      ...defaultTrainingConfig.env,
      ...config.env,
    },
  };

  // 保存到文件
  saveTrainingConfig(currentTrainingConfig);

  return { ...currentTrainingConfig };
}

/**
 * 导出获取当前 Training 配置的函数，供其他模块使用
 */
export function getCurrentTrainingConfig(): TrainingConfig {
  return { ...currentTrainingConfig };
}
