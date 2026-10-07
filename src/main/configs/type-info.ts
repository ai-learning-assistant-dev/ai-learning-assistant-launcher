import type { Channels } from '../ipc-data-type';
import {
  ContainerCreateHealthConfigOption,
  ContainerCreateMountOption,
  ContainerCreateNetNSOption,
} from '../podman-desktop/libpod-dockerode';
import type { FreeProviderConfig } from '../llm-free/type-info';

export type ServiceName = 'obsidianApp' | 'obsidianVault' | 'container' | 'TTS' | 'PDF' | 'LLM' | 'copilot';
export type ActionName = 'query' | 'update' | 'selectVoiceFile' | 'initVoiceFileList' | 'deleteVoiceFile' | 'get' | 'set' | 'testConnection' | 'syncAllApiKeys';

export const channel: Channels = 'configs';

export interface BaseContainerConfig {
  port: {
    container: number;
    host: number;
  }[];
  command: {
    start?: string[];
    stop?: string[];
  };
  env?: Record<string, string>;
  mounts?: Array<ContainerCreateMountOption>;
  healthconfig?: ContainerCreateHealthConfigOption;
  privileged?: boolean;
  restart_policy?: string;
  netns?: ContainerCreateNetNSOption;
}

export interface ContainerConfig {
  ASR: BaseContainerConfig;
  TTS: BaseContainerConfig & {
    gpuConfig?: {
      forceNvidia: boolean;
      forceCPU: boolean;
    };
  };
  LLM: BaseContainerConfig;
  PDF: BaseContainerConfig;
  TRAINING: BaseContainerConfig;
}

export interface ObsidianConfig {
  obsidianApp: {
    bin: string;
  };
}

export type ObsidianVaultConfig = { id: string; name: string; path: string };

// 语音配置接口
export interface VoiceConfig {
  name: string;
  description: string;
  filename: string;
  text?: string;
  language: string;
}

export interface VoiceConfigFile {
  voices: VoiceConfig[];
}

// PDF配置接口
export interface PdfConfig {
  start_page_id: number;
  end_page_id: number;
  table_enable: boolean;
  formula_enable: boolean;
}

export interface CustomModel {
  id?: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey?: string;
  displayName?: string;
  isEmbeddingModel?: boolean;
  capabilities?: string[];
  /**
   * 由 llm-free 维护的标记。
   * 用于把「免费模型」与「用户手工模型」区分开：
   * 1. True时这样的条目不会有编辑和删除Button
   * 2. 关闭免费代理时这些写入条目需要也被去除，因为本地代理服务已经不可用
   */
  isFreeModel?: boolean;
}

export interface LLMConfig {
  models: CustomModel[];
  /** 第三方提供模型配置块，由 llm-free 模块管理 */
  freeProvider?: FreeProviderConfig;
}

export const queryNativeTrainingConfigHandle = `${channel}queryNativeTrainingConfig`;

export const setNativeTrainingConfigHandle = `${channel}setNativeTrainingConfig`;

export interface TrainingConfig {
  env: {
    UNLOCK_ALL_SECTION: boolean;
  };
}
