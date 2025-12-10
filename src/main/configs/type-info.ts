import type { Channels } from '../ipc-data-type';
import {
  ContainerCreateHealthConfigOption,
  ContainerCreateMountOption,
  ContainerCreateNetNSOption,
} from '../podman-desktop/libpod-dockerode';

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
}

export interface LLMConfig {
  models: CustomModel[];
}

