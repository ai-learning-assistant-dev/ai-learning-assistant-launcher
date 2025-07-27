import type { ContainerConfig } from '../configs/type-info';
import { Channels } from '../ipc-data-type';

export type ServiceName = 'TTS' | 'ASR' | 'LLM' | 'PDF';
export type ActionName =
  | 'query'
  | 'install'
  | 'start'
  | 'stop'
  | 'remove'
  | 'update'
  | 'logs';

export const containerNameDict: Record<ServiceName, string> = {
  ASR: 'ASR',
  TTS: 'TTS',
  LLM: 'LLM',
  PDF: 'PDF',
};

export const imageNameDict: Record<ServiceName, string> = {
  ASR: 'ai-voice-backend:latest',
  TTS: 'ai-voice-backend:latest',
  LLM: 'LLM',
  PDF: 'mineru-pipeline:latest',
};

export const imagePathDict: Record<ServiceName, string> = {
  ASR: 'ai-voice.tar',
  TTS: 'ai-voice.tar',
  LLM: 'LLM',
  PDF: 'pdf-service.tar',
};

export const podMachineName = 'podman-machine-default';

export const channel: Channels = 'docker';
export const containerLogsChannel: Channels = 'container-logs';

/** For N Service in One Container
 * merge all config for list service into one container
 */
export function getMergedContainerConfig(
  serviceName: ServiceName,
  containerConfig: ContainerConfig,
) {
  const mergedConfig: ContainerConfig['ASR'] = {
    port: [],
    command: {
      start: [],
      stop: [],
    },
    env: { }
  };

  const containerName = containerNameDict[serviceName];
  const serviceNames: ServiceName[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const key in containerNameDict) {
    if (Object.prototype.hasOwnProperty.call(containerNameDict, key)) {
      const cName = containerNameDict[key as ServiceName];
      if (containerName === cName) {
        serviceNames.push(key as ServiceName);
      }
    }
  }
  // eslint-disable-next-line no-restricted-syntax
  for (const sName of serviceNames) {
    const config = containerConfig[sName];
    // eslint-disable-next-line no-restricted-syntax
    for (const p of config.port) {
      if (
        mergedConfig.port.findIndex((item) => item.container === p.container) <
        0
      ) {
        mergedConfig.port.push(p);
      }
    }

    for (const c of config.command.start) {
      if (
        mergedConfig.command.start.findIndex(
          (item) => item === c,
        ) < 0
      ) {
        mergedConfig.command.start.push(c);
      }
    }

    for (const c of config.command.stop) {
      if (
        mergedConfig.command.stop.findIndex(
          (item) => item === c,
        ) < 0
      ) {
        mergedConfig.command.stop.push(c);
      }
    }
  }
  return mergedConfig;
}
