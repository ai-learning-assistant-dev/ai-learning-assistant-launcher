import { BrowserWindow, IpcMain } from 'electron';
import {
  installTrainingServiceHandle,
  logsTrainingServiceHandle,
  removeTrainingServiceHandle,
  startTrainingServiceHandle,
  trainingWebURL,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import {
  getServiceLogs,
  installService,
  monitorStatusIsHealthy,
  removeService,
  startService,
  stopService,
} from '../podman-desktop/simple-container-manage';

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
  ipcHandle(ipcMain, logsTrainingServiceHandle, async (_event) =>
    logsTrainingService(),
  );
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
    autoHideMenuBar: true,
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

export async function logsTrainingService() {
  return getServiceLogs('TRAINING');
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
