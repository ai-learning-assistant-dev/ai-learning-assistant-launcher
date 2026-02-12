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
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';

const commandLine = new Exec();

export async function getServiceInfo(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    // 检查external-resources/native-training目录是否存在
    const nativeTrainingPath = path.join(
      appPath,
      'external-resources',
      'native-training',
    );

    if (existsSync(nativeTrainingPath)) {
      // 检查package.json文件是否存在
      const packageJsonPath = path.join(nativeTrainingPath, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);
          const version = packageJson.version || '0.0.0';
          return { state: 'stopped', version };
        } catch (error) {
          // 如果读取或解析失败，返回默认值
          return { state: 'stopped', version: '0.0.0' };
        }
      }
    }
  }

  return { state: 'not_install', version: '0.0.0' };
}
export async function getServiceLogs(serviceName: NativeServiceName) {}

const gitPath = path.join(appPath, 'external-resources', 'native-training');

export async function installService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    try {
      rmSync(gitPath, { recursive: true });
    } catch (e) {
      console.error(e);
    }

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
export async function uninstallService(serviceName: NativeServiceName) {
  if (serviceName === 'NATIVE_TRAINING') {
    rmSync(gitPath, { recursive: true });
  }
}
export async function startService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    await commandLine.exec(
      'bun tsoa spec-and-routes && bun tsdown && bun ./dist/app.mjs',
      [],
      {
        shell: true,
        encoding: 'utf8',
        logger: loggerFactory(serviceName),
        cwd: gitPath,
      },
    );
  }
  return { state: 'running', version: '1.0.0' };
}
export async function stopService(serviceName: NativeServiceName) {}
export async function updateService(serviceName: NativeServiceName) {}
