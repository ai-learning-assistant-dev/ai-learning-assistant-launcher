import { BrowserWindow, session, IpcMain } from 'electron';
import {
  installTrainingServiceHandle,
  removeTrainingServiceHandle,
  startTrainingServiceHandle,
  trainingWebURL,
} from './type-info';
import { wait } from '../util';
import { ipcHandle } from '../ipc-util';
import {
  getServiceInfo,
  installService,
  removeService,
  startService,
  stopService,
} from '../podman-desktop/simple-container-manage';
import { ServiceName } from '../podman-desktop/type-info';

// 全局变量存储trainingWindow实例
let trainingWindow: BrowserWindow | null = null;

export default async function init(ipcMain: IpcMain) {
  ipcHandle(ipcMain, installTrainingServiceHandle, async (_event) =>
    installTrainingService(),
  );
  ipcHandle(ipcMain, startTrainingServiceHandle, async (_event) =>
    startTrainingService(),
  );
  ipcHandle(ipcMain, removeTrainingServiceHandle, async (_event) =>
    removeTrainingService(),
  );
}

async function monitorStatusIsHealthy(service: ServiceName) {
  return new Promise<void>((resolve, reject) => {
    const interval = setInterval(async () => {
      const newInfo = await getServiceInfo(service);
      if (newInfo) {
        if (newInfo.Status !== 'starting') {
          if (newInfo.Status === 'healthy') {
            clearInterval(interval);
            resolve();
          } else {
            clearInterval(interval);
            reject();
          }
        } else {
          // do nothing
        }
      } else {
        clearInterval(interval);
        reject();
      }
    }, 1000);
  });
}

const createWindow = (): void => {
  if (trainingWindow && !trainingWindow.isDestroyed()) {
    if (trainingWindow.isMinimized()) {
      trainingWindow.restore();
    }
    trainingWindow.focus();
    return;
  }

  trainingWindow = new BrowserWindow({
    height: 900,
    width: 1400,
  });

  // 修改CSP以允许获取验证码
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (
      details.url.startsWith(trainingWebURL) ||
      details.url.includes('geetest.com') ||
      details.url.includes('geevisit.com')
    ) {
      const customCSP = [
        "default-src 'self' http://127.0.0.1:7100 blob: data:",
        "script-src 'self' 'unsafe-inline' blob: data: https://api.geetest.com https://static.geetest.com https://monitor.geetest.com https://static.geevisit.com",
        "connect-src 'self' blob: data: https://api.geetest.com https://static.geetest.com https://monitor.geetest.com https://static.geevisit.com",
        "style-src 'self' 'unsafe-inline' https://static.geetest.com https://static.geevisit.com",
        "img-src 'self' data: blob: https://github.com https://*.github.com https://*.githubusercontent.com https://static.geetest.com https://static.geevisit.com",
        "media-src 'self' blob: data: http://127.0.0.1:7100 https://static.geetest.com https://static.geevisit.com",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-src 'self' blob: data: https://*.geetest.com",
        "worker-src 'self' blob: data:",
      ].join('; ');

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [customCSP],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  trainingWindow.loadURL(trainingWebURL);

  trainingWindow.on('closed', async () => {
    trainingWindow = null;
    await stopService('TRAINING');
  });
};

export async function installTrainingService() {
  return installService('TRAINING');
}

export async function removeTrainingService() {
  return removeService('TRAINING');
}

export async function startTrainingService() {
  const info = await startService('TRAINING');
  if (info && info.Status === 'healthy') {
    createWindow();
  } else {
    await monitorStatusIsHealthy('TRAINING');
    createWindow();
  }
  return { someData: 'data1' };
}
