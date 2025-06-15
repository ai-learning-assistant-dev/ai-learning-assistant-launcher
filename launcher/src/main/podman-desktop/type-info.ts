import { Channels } from '../preload';

export type ServiceName = 'TTS' | 'ASR' | 'LLM';
export type ActionName =
  | 'query'
  | 'install'
  | 'start'
  | 'stop'
  | 'remove'
  | 'update';

export const imageNameDict: Record<ServiceName, string> = {
  ASR: '',
  TTS: 'docker.io/library/ai-tts:latest',
  LLM: '',
};

export const imagePathDict: Record<ServiceName, string> = {
  ASR: '',
  TTS: 'ai-tts.tar',
  LLM: '',
};

export const podMachineName = 'podman-machine-default';

export enum MESSAGE_TYPE {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  DATA = 'data',
  PROGRESS = 'progress',
  PROGRESS_ERROR = 'progress_success',
}

export const channel: Channels = 'docker';
