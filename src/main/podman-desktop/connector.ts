import Dockerode from 'dockerode';
import { isMac, isWindows } from '../exec/util';
import { extensionApi } from './real-api';
import { LibPod, LibpodDockerode } from './libpod-dockerode';

export const macosExtraPath =
  '/opt/podman/bin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin';

export function getInstallationPath(envPATH?: string): string {
  envPATH ??= process.env.PATH;

  if (isWindows()) {
    return `c:\\Program Files\\RedHat\\Podman;${envPATH}`;
  }
  if (isMac()) {
    if (!envPATH) {
      return macosExtraPath;
    }
    return macosExtraPath.concat(':').concat(envPATH);
  }
  return envPATH ?? '';
}

export function getPodmanCli(): string {
  if (isWindows()) {
    return 'podman.exe';
  }
  return 'podman';
}

async function getSocketPath(machineName: string): Promise<string> {
  let socketPath: string = '';
  const { stdout: socket } = await extensionApi.process.exec(getPodmanCli(), [
    'machine',
    'inspect',
    '--format',
    '{{.ConnectionInfo.PodmanPipe.Path}}',
    machineName,
  ]);
  socketPath = socket;
  return socketPath;
}

const libPodDockerode = new LibpodDockerode();
libPodDockerode.enhancePrototypeWithLibPod();

export async function connect(
  machineName: string = 'podman-machine-default',
): Promise<LibPod & Dockerode> {
  const socketPath = await getSocketPath(machineName);
  console.debug('Socket Path: ', socketPath);
  return new Dockerode({ socketPath }) as unknown as LibPod & Dockerode;
}
