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
  haveNewVersionNativeTrainingServiceHandle,
  updateNativeTrainingServiceHandle,
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
import git from 'isomorphic-git';
import fs from 'fs';
import { getRemoteInfo } from '../git';
import { TRAINING_REPO_URL, TRAINING_REPO_BRANCH } from '../native-script/type-info';

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
  ipcHandle(ipcMain, updateNativeTrainingServiceHandle, async (_event) =>
    updateTrainingService(),
  );
  ipcHandle(
    ipcMain,
    haveNewVersionNativeTrainingServiceHandle,
    async (_event) => haveNewVersionTrainingService(),
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
    trainingWindow && trainingWindow.close();
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
    const trainingInfo = await getServiceInfo('NATIVE_TRAINING');
    const depVersions = trainingInfo?.version? {
      TRAINING_SOURCE: trainingInfo.version,
    } : {};
    console.debug('开始下载课程数据');
    const latestVersion = getLatestVersion('TRAINING_COURSE', depVersions);
    await startWebtorrent(latestVersion.dlcInfo.magnet);
    let coursePath = '';
    try {
      const torrent = await waitTorrentDone(
        'TRAINING_COURSE',
        latestVersion.version,
      );
      coursePath = path.join(torrent.path, torrent.files[0].name);
    } catch (e) {
      console.error(e);
      return { someData: 'data1' };
    }
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
    } catch (e) {
      console.warn(e);
    } finally {
      await stopService('NATIVE_TRAINING');
    }
    try {
      trainingWindow && trainingWindow.reload();
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
  const trainingInfo = await getServiceInfo('NATIVE_TRAINING');
  const depVersions = trainingInfo?.version? {
    TRAINING_SOURCE: trainingInfo.version,
  } : {};
  const currentVersion = await getCourseVersion();
  try{
    const latestVersion = getLatestVersion('TRAINING_COURSE', depVersions);
    return {
      currentVersion: currentVersion,
      latestVersion: latestVersion.version,
      haveNew: currentVersion != latestVersion.version,
    };
  }catch(e){
    console.warn(e);
    return {
      currentVersion: currentVersion,
      latestVersion: currentVersion,
      haveNew: false,
    }
  }
}

/**
 * 检查本地版本是否落后于远程版本
 * 使用 git 对比本地 HEAD 和远程分支的最新 commit
 * @returns 如果本地落后则返回 true，否则返回 false
 */
export async function haveNewVersionTrainingService(): Promise<{
  haveNew: boolean;
  currentVersion?: string;
  latestVersion?: string;
  error?: string;
}> {
  try {
    // 检查本地目录是否存在
    if (!existsSync(trainingServerSourcePath)) {
      return { haveNew: false, error: '本地服务未安装' };
    }

    // 获取本地 package.json中的版本
    const packageJsonPath = path.join(trainingServerSourcePath, 'package.json');
    let currentVersion = '0.0.0';
    if (existsSync(packageJsonPath)) {
      try {
        const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        currentVersion = packageJson.version || '0.0.0';
      } catch (error) {
        console.warn('读取本地package.json失败:', error);
        currentVersion = '0.0.0';
      }
    }

    // 获取dlc信息中TRAINING_SOURCE的最新版本
    let latestVersion = '0.0.0';
    try {
      const latestVersionInfo = getLatestVersion('TRAINING_SOURCE', {});
      latestVersion = latestVersionInfo.version;
    } catch (error) {
      console.warn('获取TRAINING_SOURCE最新版本失败:', error);
      latestVersion = '0.0.0';
    }
    
    // 对比本地和远程版本
    const haveNew = currentVersion !== latestVersion;

    console.debug(
      `版本检查: 本地版本=${currentVersion}, 远程版本=${latestVersion}, 有新版本=${haveNew}`,
    );

    return {
      haveNew,
      currentVersion,
      latestVersion,
    };
  } catch (e) {
    console.warn('检查新版本时发生错误:', e);
    return { haveNew: false, error: '检查新版本时发生未知错误' };
  }
}

/**
 * 更新 Training Service
 * 执行 stopService -> installService，返回 installService 的结果
 */
export async function updateTrainingService() {
  // 先停止服务
  await stopService('NATIVE_TRAINING');

  // 执行安装服务（会重新克隆并安装）
  const result = await installTrainingService();

  return result;
}
