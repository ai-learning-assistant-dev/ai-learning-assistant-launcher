import path from 'path';
import { gitClone } from '../git';
import {
  NativeServiceItem,
  NativeServiceName,
  NativeServiceInfo,
  TRAINING_PORT,
  TRAINING_REPO_URL,
  TRAINING_REPO_BRANCH,
} from './type-info';
import { appPath, isWindows } from '../exec/util';
import { Exec } from '../exec';
import { loggerFactory } from '../terminal-log';
import { existsSync, readFileSync, mkdirSync, rmSync, cpSync } from 'fs';
import { CancellationTokenSourceImpl } from '../exec/cancellation-token';
import http from 'http';
import { llmConfigPath } from '../configs';
import { queryTrainingConfig } from '../configs/training-config';

const commandLine = new Exec();

// 根据进程名终止进程
async function killProcessByName(processName: string): Promise<void> {
  try {
    if (isWindows()) {
      // Windows: 使用taskkill根据进程名终止进程
      await commandLine.exec('taskkill', ['/F', '/IM', processName]);
      console.debug(`已终止进程: ${processName}`);
    } else {
      // macOS/Linux: 使用pkill根据进程名终止进程
      await commandLine.exec('pkill', ['-9', '-f', processName]);
      console.debug(`已终止进程: ${processName}`);
    }
  } catch (error) {
    // 如果命令执行失败（例如没有找到该进程），忽略错误
    console.debug(`没有找到进程 ${processName} 或无法终止:`, error);
  }
}

// 终止占用指定端口的进程
async function killProcessOnPort(port: number): Promise<void> {
  try {
    if (isWindows()) {
      // Windows: 使用netstat查找占用端口的进程ID
      // 注意：这里使用shell命令字符串，因为netstat和findstr需要管道连接
      const netstatResult = await commandLine.exec(
        `netstat -ano | findstr :${port}`,
        [],
        {
          shell: true,
        },
      );

      const lines = netstatResult.stdout.split('\n');
      const pids = new Set<string>();

      for (const line of lines) {
        const match = line.match(/\s+(\d+)$/);
        if (match) {
          pids.add(match[1]);
        }
      }

      // 终止所有找到的进程
      for (const pid of pids) {
        try {
          // 安全检查：不终止关键系统进程
          const isCritical = Number(pid) == 0;
          if (isCritical) {
            console.warn(`跳过关键系统进程 PID: ${pid} (端口: ${port})`);
            continue;
          }

          await commandLine.exec('taskkill', ['/F', '/PID', pid]);
          console.debug(`已终止进程 PID: ${pid} (端口: ${port})`);
        } catch (error) {
          console.warn(`无法终止进程 PID: ${pid}`, error);
        }
      }
    } else {
      // macOS/Linux: 使用lsof查找占用端口的进程ID
      const lsofResult = await commandLine.exec('lsof', ['-ti', `:${port}`]);

      const pids = lsofResult.stdout
        .trim()
        .split('\n')
        .filter((pid) => pid.trim() !== '');

      // 终止所有找到的进程
      for (const pid of pids) {
        try {
          await commandLine.exec('kill', ['-9', pid]);
          console.debug(`已终止进程 PID: ${pid} (端口: ${port})`);
        } catch (error) {
          console.warn(`无法终止进程 PID: ${pid}`, error);
        }
      }
    }
  } catch (error) {
    // 如果命令执行失败（例如没有找到占用端口的进程），忽略错误
    console.debug(`没有找到占用端口 ${port} 的进程或无法终止:`, error);
  }
}

// 健康检查函数，检查服务是否在运行
async function checkServiceHealth(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      // 如果状态码是2xx或3xx，认为服务是健康的
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
        resolve(true);
      } else {
        resolve(false);
      }
      res.resume(); // 消耗响应数据以释放连接
    });

    req.on('error', () => {
      resolve(false);
    });

    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

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

          // 检查http://127.0.0.1:7100是否能正常访问，如果能访问,则返回的state是running，否则是stopped
          const isHealthy = await checkServiceHealth('http://127.0.0.1:7100');
          return { state: isHealthy ? 'running' : 'stopped', version };
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

export async function installService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  if (serviceName === 'NATIVE_TRAINING') {
    console.debug('开始清除旧版本');
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

    mkdirSync(trainingFrontendPath, { recursive: true });

    console.debug('开始下载程序');

    try {
      await gitClone(
        TRAINING_REPO_URL,
        trainingServerSourcePath,
        TRAINING_REPO_BRANCH,
      );
    } catch (e) {
      console.error(e);
      console.error('下载程序失败');
      return { state: 'not_install', version: '0.0.0' };
    }

    console.debug('开始编译程序');
    try{
      await commandLine.exec('bun install', [], {
        shell: true,
        logger: loggerFactory(serviceName),
        cwd: trainingServerSourcePath,
      });
    }catch(e){
      console.error(e);
      console.error('编译程序失败');
    }

    return { state: 'stopped', version: '1.0.0' };
  }
}
export async function monitorStateIsRuning(
  serviceName: NativeServiceName,
): Promise<void> {
  if (serviceName === 'NATIVE_TRAINING') {
    let retryCounter = 30;
    console.debug('checking health', serviceName);
    return new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        const newInfo = await getServiceInfo(serviceName);
        if (newInfo) {
          if (newInfo.state !== 'stopped') {
            if (newInfo.state === 'running') {
              clearInterval(interval);
              resolve();
            } else {
              clearInterval(interval);
              reject();
            }
          } else {
            // do nothing
            if (retryCounter > 0) {
              retryCounter--;
            } else {
              reject('服务超时还未启动');
            }
          }
        } else {
          clearInterval(interval);
          reject();
        }
      }, 1000);
    });
  }
}
export async function uninstallService(serviceName: NativeServiceName) {
  if (serviceName === 'NATIVE_TRAINING') {
    // 终止占用7100端口的进程
    try {
      await killProcessOnPort(7100);
    } catch (e) {
      console.warn(e);
    }
    // 终止bun.exe进程
    try {
      await killProcessByName('bun.exe');
    } catch (e) {
      console.warn(e);
    }
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
    const info = await getServiceInfo(serviceName);
    const trainingConfig = await queryTrainingConfig();
    if (info.state !== 'running') {
      const tokenSource = new CancellationTokenSourceImpl();
      commandLine
        .exec(
          `set PORT=${TRAINING_PORT} && set "ALA_LLM_CONFIG_PATH=${llmConfigPath}" && set "UNLOCK_ALL_SECTION=${trainingConfig.env.UNLOCK_ALL_SECTION}" && bun dev`,
          [],
          {
            shell: true,
            encoding: 'utf8',
            logger: loggerFactory(serviceName),
            cwd: trainingServerSourcePath,
            token: tokenSource.token,
          },
        )
        .catch((e) => {
          console.warn(e);
          console.debug('学科培训服务停止了');
        });
    }
    try {
      await monitorStateIsRuning(serviceName);
    } catch (e) {
      console.error(e);
      await stopService(serviceName);
    }

    return getServiceInfo(serviceName);
  }
  return { state: 'running', version: '1.0.0' };
}
export async function stopService(serviceName: NativeServiceName) {
  if (serviceName === 'NATIVE_TRAINING') {
    try {
      await killProcessOnPort(TRAINING_PORT);
    } catch (e) {
      console.warn(e);
    }
    // 终止bun.exe进程
    try {
      await killProcessByName('bun.exe');
    } catch (e) {
      console.warn(e);
    }
  }
}

export async function updateService(serviceName: NativeServiceName) {}
