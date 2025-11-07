import { BrowserWindow, IpcMain } from 'electron';
import { startTrainingServiceHandle, trainingWebURL } from './type-info';
import { wait } from '../util';
import { ipcHandle } from '../ipc-util';

export default async function init(ipcMain: IpcMain) {
  ipcHandle(ipcMain, startTrainingServiceHandle, async (_event) =>
    startTrainingService(),
  );
}

export async function startTrainingService() {
  createWindow();
  return { someData: 'data1' };
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