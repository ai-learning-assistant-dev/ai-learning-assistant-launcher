import type { Channels } from '../ipc-data-type';
import { ContainerCreateMountOption } from '../podman-desktop/libpod-dockerode';

export type ServiceName = 'obsidianApp' | 'obsidianVault' | 'container' | 'TTS' | 'showcase';
export type ActionName = 'query' | 'update' | 'selectVoiceFile' | 'initVoiceFileList' | 'deleteVoiceFile' | 'addWorkspace';

export const channel: Channels = 'configs';

export interface ContainerConfig {
  ASR: {
    port: {
      container: number;
      host: number;
    }[];
    command: {
      start: string[];
      stop: string[];
    };
    env?: Record<string, string>;
    mounts?: Array<ContainerCreateMountOption>;
  };
  TTS: {
    port: {
      container: number;
      host: number;
    }[];
    command: {
      start: string[];
      stop: string[];
    };
    env?: Record<string, string>;
    mounts?: Array<ContainerCreateMountOption>;
    gpuConfig?: {
      forceNvidia: boolean;
      forceCPU: boolean;
    };
  };
  LLM: {
    port: {
      container: number;
      host: number;
    }[];
    command: {
      start: string[];
      stop: string[];
    };
    env?: Record<string, string>;
    mounts?: Array<ContainerCreateMountOption>;
  };
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
