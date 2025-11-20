import { BrowserWindow, IpcMain } from 'electron';
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
} from '../podman-desktop/simple-container-manage';
import { ServiceName } from '../podman-desktop/type-info';

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
    });
  });
}

const createWindow = (): void => {
  // Create the browser window.
  const trainingWindow = new BrowserWindow({
    height: 900,
    width: 1400,
  });

  // and load the index.html of the app.
  trainingWindow.loadURL(trainingWebURL);

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
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
