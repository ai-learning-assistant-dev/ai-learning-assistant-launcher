import Dockerode from 'dockerode';
import { isMac, isWindows } from '../exec/util';
import { extensionApi } from './real-api';
import { LibPod, LibpodDockerode } from './libpod-dockerode';
import { podMachineName } from './type-info';
import { getPodmanSocketPath } from './ensure-podman-works';

const libPodDockerode = new LibpodDockerode();
libPodDockerode.enhancePrototypeWithLibPod();

export async function connect(
  machineName: string = podMachineName,
): Promise<LibPod & Dockerode> {
  const socketPath = await getPodmanSocketPath(machineName);
  console.debug('Socket Path: ', socketPath);
  return new Dockerode({ socketPath }) as unknown as LibPod & Dockerode;
}
