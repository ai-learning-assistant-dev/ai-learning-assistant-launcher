import type { Channels } from '../ipc-data-type';

export type ServiceName =
  | 'qwen/qwen3-32b'
  | 'google/gemma-3-27b'
  | 'qwen/qwen3-embedding-0.6b';
export type ActionName =
  | 'query'
  | 'install'
  | 'start'
  | 'stop'
  | 'remove'
  | 'update';

export const channel: Channels = 'lm-studio';

const modelListSample = {
  type: 'embedding',
  modelKey: 'text-embedding-nomic-embed-text-v1.5',
  format: 'gguf',
  displayName: 'Nomic Embed Text v1.5',
  path: 'nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.Q4_K_M.gguf',
  sizeBytes: 84106624,
  architecture: 'nomic-bert',
  maxContextLength: 2048,
};

export type LMModel = typeof modelListSample & {
  isLoaded: boolean;
};

export const modelKeyDict: Record<ServiceName, string> = {
  'qwen/qwen3-32b': '',
  'qwen/qwen3-embedding-0.6b': 'text-embedding-qwen3-embedding-0.6b',
  'google/gemma-3-27b': '',
};

export const lmsGetNameDict: Record<ServiceName, string> = {
  'qwen/qwen3-32b': 'qwen3-32b',
  'qwen/qwen3-embedding-0.6b': 'qwen3-embedding-0.6b',
  'google/gemma-3-27b': 'gemma-3-27b',
};
