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
import { existsSync, readFileSync, mkdirSync, rmSync, cpSync } from 'fs';

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

const trainingServerSourcePath = path.join(
  appPath,
  'external-resources',
  'native-training',
);
const trainingServerSourcePublicPath = path.join(
  trainingServerSourcePath,
  'public',
);
const trainingFrontendPath = path.join(
  appPath,
  'external-resources',
  'native-training-front-tmp',
);
const trainingFrontendDistPath = path.join(trainingFrontendPath, 'dist');

export async function installService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    try {
      rmSync(trainingServerSourcePath, { recursive: true });
    } catch (e) {
      console.warn(e);
    }
    mkdirSync(trainingServerSourcePath, { recursive: true });

    try {
      rmSync(trainingFrontendPath, { recursive: true });
    } catch (e) {
      console.warn(e);
    }

    console.debug('开始下载程序');

    mkdirSync(trainingFrontendPath, { recursive: true });
    await gitClone(
      'https://github.com/ai-learning-assistant-dev/ai-learning-assistant-training-server.git',
      trainingServerSourcePath,
      'version-manager',
    );

    console.debug('开始编译程序');
    await commandLine.exec(
      'bun install && bun tsoa spec-and-routes && bun tsdown',
      [],
      {
        shell: true,
        logger: loggerFactory(serviceName),
        cwd: trainingServerSourcePath,
      },
    );
    await gitClone(
      'https://github.com/ai-learning-assistant-dev/ai-learning-assistant-training-front.git',
      trainingFrontendPath,
      'main',
    );
    await commandLine.exec('bun install && bun tsc -b && bun vite build', [], {
      shell: true,
      logger: loggerFactory(serviceName),
      cwd: trainingFrontendPath,
    });

    cpSync(trainingFrontendDistPath, trainingServerSourcePublicPath, {
      recursive: true,
    });

    rmSync(trainingFrontendPath);

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
    rmSync(trainingServerSourcePath, { recursive: true });
    try {
      rmSync(trainingFrontendPath, { recursive: true });
    } catch (e) {
      console.warn(e);
    }
  }
}
export async function startService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    await commandLine.exec('set PORT=7100 && bun ./dist/app.mjs', [], {
      shell: true,
      encoding: 'utf8',
      logger: loggerFactory(serviceName),
      cwd: trainingServerSourcePath,
    });
  }
  return { state: 'running', version: '1.0.0' };
}
export async function stopService(serviceName: NativeServiceName) {}
export async function updateService(serviceName: NativeServiceName) {}
