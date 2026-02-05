import path from 'path';
import { gitClone } from '../git';
import {
  NativeServiceItem,
  NativeServiceName,
  NativeServiceInfo,
} from './type-info';
import { appPath } from '../exec/util';
import { Exec } from '../exec';
import { loggerFactory } from '../terminal-log';
import { mkdirSync, rm, rmSync, unlinkSync } from 'fs';

const commandLine = new Exec();

export async function getServiceInfo(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  return { state: 'not_install', version: '1.0.0' };
}
export async function getServiceLogs(serviceName: NativeServiceName) {}

const gitPath = path.join(appPath, 'external-resources', 'native-training');

export async function installService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    rmSync(gitPath, { recursive: true });
    mkdirSync(gitPath, { recursive: true });
    await gitClone(
      'https://github.com/ai-learning-assistant-dev/ai-learning-assistant-training-server.git',
      gitPath,
      'version-manager',
    );
    await commandLine.exec('bun install', [], {
      shell: true,
      logger: loggerFactory(serviceName),
      cwd: gitPath,
    });
    return { state: 'stopped', version: '1.0.0' };
  }
}
export async function monitorStatusIsHealthy(
  serviceName: NativeServiceName,
): Promise<boolean> {
  return true;
}
export async function uninstallService(serviceName: NativeServiceName) {}
export async function startService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    await commandLine.exec('bun tsdown && bun ./dist/app.mjs', [], {
      shell: true,
      logger: loggerFactory(serviceName),
      cwd: gitPath,
    });
  }
  return { state: 'running', version: '1.0.0' };
}
export async function stopService(serviceName: NativeServiceName) {}
export async function updateService(serviceName: NativeServiceName) {}
