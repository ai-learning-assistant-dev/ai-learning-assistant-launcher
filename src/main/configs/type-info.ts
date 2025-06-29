import type { Channels } from '../ipc-data-type';

export type ServiceName = 'obsidianApp' | 'obsidianVault';
export type ActionName = 'query' | 'update';

export const channel: Channels = 'configs';

export interface ContainerConfig {
  ASR: {
    port: {
      container: number;
      host: number;
    }[];
  };
  TTS: {
    port: {
      container: number;
      host: number;
    }[];
  };
  VOICE: {
    port: {
      container: number;
      host: number;
    }[];
  };
  LLM: {
    port: {
      container: number;
      host: number;
    }[];
  };
}

export interface ObsidianConfig {
  obsidianApp: {
    bin: string;
  };
}

export type ObsidianVaultConfig = { id: string; name: string; path: string };
