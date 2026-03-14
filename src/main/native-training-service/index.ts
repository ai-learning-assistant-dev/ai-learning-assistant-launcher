import { BrowserWindow, IpcMain } from 'electron';
import {
  queryNativeTrainingServiceHandle,
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
  monitorStateIsRuning,
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
import { appPath, Exec } from '../exec';
import { CancellationTokenSourceImpl } from '../exec/cancellation-token';
import { loggerFactory } from '../terminal-log';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const commandLine = new Exec();

// 全局变量存储trainingWindow实例
let trainingWindow: BrowserWindow | null = null;

export default async function init(ipcMain: IpcMain) {
  ipcHandle(ipcMain, queryNativeTrainingServiceHandle, async (_event) =>
    queryTrainingService(),
  );
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

export async function queryTrainingService() {
  return getServiceInfo('NATIVE_TRAINING');
}

export async function installTrainingService() {
  const installedInfo = await installService('NATIVE_TRAINING');
  const info = await startService('NATIVE_TRAINING');
  if (info && info.state === 'running') {
    await updateCourseTrainingService();
  } else {
    await monitorStateIsRuning('NATIVE_TRAINING');
    await updateCourseTrainingService();
  }
  await stopService('NATIVE_TRAINING');
  return installedInfo;
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
  if (info && info.state === 'running') {
    createWindow();
  } else {
    await monitorStateIsRuning('NATIVE_TRAINING');
    createWindow();
  }
  return { someData: 'data1' };
}

const trainingServerSourcePath = path.join(
  appPath,
  'external-resources',
  'native-training',
);

// 检查external-resources/native-training目录是否存在
const nativeTrainingPath = path.join(
  appPath,
  'external-resources',
  'native-training',
);
const courseVersionMark = path.join(nativeTrainingPath, 'course-version.json');

export async function updateCourseTrainingService() {
  console.debug('检查是否有新课程');
  if ((await courseHaveNewVersionTrainingService()).haveNew) {
    console.debug('开始下载课程数据');
    const latestVersion = getLatestVersion('TRAINING_COURSE');
    await startWebtorrent(latestVersion.dlcInfo.magnet);
    const torrent = await waitTorrentDone(
      'TRAINING_COURSE',
      latestVersion.version,
    );
    const coursePath = path.join(torrent.path, torrent.files[0].name);
    console.debug('将课程导入到学科培训');
    await stopService('NATIVE_TRAINING');
    await startService('NATIVE_TRAINING');
    try {
      const tokenSource = new CancellationTokenSourceImpl();
      await commandLine.exec(
        `bun db:import:course "${coursePath}" --base-url=http://localhost:7100`,
        [],
        {
          shell: true,
          encoding: 'utf8',
          logger: loggerFactory('NATIVE_TRAINING'),
          cwd: trainingServerSourcePath,
          token: tokenSource.token,
        },
      );
      // 留下版本标记
      writeFileSync(
        courseVersionMark,
        JSON.stringify({ version: latestVersion.version }, null, 2),
      );
      console.debug('成功将课程导入到学科培训');
    } finally {
      await stopService('NATIVE_TRAINING');
    }
    try {
      trainingWindow.reload();
    } catch (e) {
      console.warn(e);
    }
  } else {
    console.debug('没有新课程');
  }
  return { someData: 'data1' };
}

export async function getCourseVersion() {
  if (existsSync(nativeTrainingPath)) {
    const courseVersionMark = path.join(
      nativeTrainingPath,
      'course-version.json',
    );
    if (existsSync(courseVersionMark)) {
      try {
        const courseVersionJsonContent = readFileSync(
          courseVersionMark,
          'utf-8',
        );
        const courseVersionJson = JSON.parse(courseVersionJsonContent);
        const version: string = courseVersionJson.version || '0.0.0';
        return version;
      } catch (error) {
        return '0.0.0';
      }
    }
  }
  return '0.0.0';
}

export async function courseHaveNewVersionTrainingService() {
  const currentVersion = await getCourseVersion();
  const latestVersion = getLatestVersion('TRAINING_COURSE');
  return {
    currentVersion: currentVersion,
    latestVersion: latestVersion.version,
    haveNew: currentVersion != latestVersion.version,
  };
}
