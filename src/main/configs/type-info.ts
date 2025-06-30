import type { Channels } from '../ipc-data-type';
import { ContainerCreateMountOption } from '../podman-desktop/libpod-dockerode';

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
