import type { Channels } from '../ipc-data-type';
import { ContainerCreateMountOption } from '../podman-desktop/libpod-dockerode';

export type ServiceName = 'obsidianApp' | 'obsidianVault' | 'container' | 'TTS' | 'PDF';
export type ActionName = 'query' | 'update' | 'selectVoiceFile' | 'initVoiceFileList' | 'deleteVoiceFile' | 'get' | 'set';

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
    privileged?: boolean;
    restart_policy?: string;
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
    privileged?: boolean;
    restart_policy?: string;
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
    privileged?: boolean;
    restart_policy?: string;
  };
  PDF: {
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
    privileged?: boolean;
    restart_policy?: string;
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

// PDF配置接口
export interface PdfConfig {
  start_page_id: number;
  end_page_id: number;
  table_enable: boolean;
  formula_enable: boolean;
}
