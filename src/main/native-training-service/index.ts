import { BrowserWindow, IpcMain } from 'electron';
import {
  installNativeTrainingServiceHandle,
  logsNativeTrainingServiceHandle,
  removeNativeTrainingServiceHandle,
  startNativeTrainingServiceHandle,
  updateCourseNativeTrainingServiceHandle,
  trainingWebURL,
  courseHaveNewVersionNativeTrainingServiceHandle,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import {
  getServiceInfo,
  getServiceLogs,
  installService,
  monitorStatusIsHealthy,
  uninstallService,
  startService,
  stopService,
  updateService,
} from '../native-script';
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
  ipcHandle(ipcMain, installNativeTrainingServiceHandle, async (_event) =>
    installTrainingService(),
  );
  ipcHandle(ipcMain, startNativeTrainingServiceHandle, async (_event) =>
    startTrainingService(),
  );
  ipcHandle(ipcMain, removeNativeTrainingServiceHandle, async (_event) =>
    removeTrainingService(),
  );
  ipcHandle(ipcMain, logsNativeTrainingServiceHandle, async (_event) =>
    logsTrainingService(),
  );
  ipcHandle(ipcMain, updateCourseNativeTrainingServiceHandle, async (_event) =>
    updateCourseTrainingService(),
  );
  ipcHandle(
    ipcMain,
    courseHaveNewVersionNativeTrainingServiceHandle,
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
    await stopService('NATIVE_TRAINING');
  });
};

export async function installTrainingService() {
  const latestVersion = getLatestVersion('TRAINING_TAR');
  await startWebtorrent(latestVersion.dlcInfo.magnet);
  const torrent = await waitTorrentDone('TRAINING_TAR', latestVersion.version);
  const tarPath = path.join(torrent.path, torrent.files[0].name);
  return installService('NATIVE_TRAINING');
}

export async function removeTrainingService() {
  try {
    trainingWindow.close();
  } catch (e) {
    console.warn(e);
  }
  return uninstallService('NATIVE_TRAINING');
}

export async function logsTrainingService() {
  return getServiceLogs('NATIVE_TRAINING');
}

export async function startTrainingService() {
  const info = await startService('NATIVE_TRAINING');
  if (info && info.Status === 'healthy') {
    createWindow();
  } else {
    await monitorStatusIsHealthy('NATIVE_TRAINING');
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
    await startWebtorrent(latestVersion.dlcInfo.magnet);
    const torrent = await waitTorrentDone(
      'TRAINING_TAR',
      latestVersion.version,
    );
    try {
      await stopService('NATIVE_TRAINING');
      await uninstallService('NATIVE_TRAINING');
    } catch (e) {
      console.warn(e);
    }
    const tarPath = path.join(torrent.path, torrent.files[0].name);
    await updateService('NATIVE_TRAINING');
    return { someData: 'data1' };
  }
}

export async function getCourseVersion() {
  const info = await getServiceInfo('NATIVE_TRAINING');
  const labelVersion = info && info.version;
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
