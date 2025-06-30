import type { Channels } from '../ipc-data-type';

export type ServiceName = 'obsidianApp' | 'obsidianVault' | 'container';
export type ActionName = 'query' | 'update';

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
  };
}

export interface ObsidianConfig {
  obsidianApp: {
    bin: string;
  };
}

export type ObsidianVaultConfig = { id: string; name: string; path: string };
