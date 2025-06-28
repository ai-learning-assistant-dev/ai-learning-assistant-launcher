import type { ContainerConfig } from '../configs/type-info';
import { Channels } from '../ipc-data-type';

export type ServiceName = 'TTS' | 'ASR' | 'LLM';
export type ActionName =
  | 'query'
  | 'install'
  | 'start'
  | 'stop'
  | 'remove'
  | 'update';

export const containerNameDict: Record<ServiceName, string> = {
  ASR: 'ASR_TTS',
  TTS: 'ASR_TTS',
  LLM: '',
};

export const imageNameDict: Record<ServiceName, string> = {
  ASR: 'ai-voice-backend:latest',
  TTS: 'ai-voice-backend:latest',
  LLM: '',
};

export const imagePathDict: Record<ServiceName, string> = {
  ASR: 'ai-voice.tar',
  TTS: 'ai-voice.tar',
  LLM: '',
};

export const podMachineName = 'podman-machine-default';

export const channel: Channels = 'docker';

/** For N Service in One Container
 * merge all config for list service into one container
 */
export function getMergedContainerConfig(
  serviceName: ServiceName,
  containerConfig: ContainerConfig,
) {
  const mergedConfig: ContainerConfig['ASR'] = {
    port: [],
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
  }
  return mergedConfig;
}
