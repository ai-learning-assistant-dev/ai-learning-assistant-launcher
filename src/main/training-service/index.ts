import { BrowserWindow, IpcMain } from 'electron';
import {
  installTrainingServiceHandle,
  logsTrainingServiceHandle,
  removeTrainingServiceHandle,
  startTrainingServiceHandle,
  updateCourseTrainingServiceHandle,
  trainingWebURL,
  courseHaveNewVersionTrainingServiceHandle,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import {
  getServiceInfo,
  getServiceLogs,
  installService,
  monitorStatusIsHealthy,
  removeService,
  startService,
  stopService,
  updateService,
} from '../podman-desktop/simple-container-manage';
import {
  getDLCIndex,
  getLatestVersion,
  isLatestVersion,
  startWebtorrent,
  waitTorrentDone,
} from '../dlc';
import path from 'node:path';

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
  ipcHandle(ipcMain, updateCourseTrainingServiceHandle, async (_event) =>
    updateCourseTrainingService(),
  );
  ipcHandle(
    ipcMain,
    courseHaveNewVersionTrainingServiceHandle,
    async (_event) => courseHaveNewVersionTrainingService(),
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
  const latestVersion = getLatestVersion('TRAINING_TAR');
  const torrent = await startWebtorrent(latestVersion.dlcInfo.magnet);
  await waitTorrentDone('TRAINING_TAR', latestVersion.version);
  const tarPath = path.join(torrent.path, torrent.files[0].name);
  return installService('TRAINING', null, tarPath);
}

export async function removeTrainingService() {
  try {
    trainingWindow.close();
  } catch (e) {
    console.warn(e);
  }
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

export async function updateCourseTrainingService() {
  try {
    trainingWindow.close();
  } catch (e) {
    console.warn(e);
  }
  if ((await courseHaveNewVersionTrainingService()).haveNew) {
    const latestVersion = getLatestVersion('TRAINING_TAR');
    const torrent = await startWebtorrent(latestVersion.dlcInfo.magnet);
    await waitTorrentDone('TRAINING_TAR', latestVersion.version);
    try {
      await stopService('TRAINING');
      await removeService('TRAINING');
    } catch (e) {
      console.warn(e);
    }
    const tarPath = path.join(torrent.path, torrent.files[0].name);
    await updateService('TRAINING', null, tarPath);
    return { someData: 'data1' };
  }
}

export async function getCourseVersion() {
  const info = await getServiceInfo('TRAINING');
  const labelVersion = info && info.Labels && info.Labels.version;
  console.debug('labelVersion', labelVersion);
  return labelVersion ? labelVersion : '0.0.1';
}

export async function courseHaveNewVersionTrainingService() {
  const currentVersion = await getCourseVersion();
  return {
    currentVersion: currentVersion,
    latestVersion: getLatestVersion('TRAINING_TAR').version,
    haveNew: !isLatestVersion('TRAINING_TAR', currentVersion),
  };
}
