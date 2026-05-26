import { BrowserWindow, IpcMain } from 'electron';
import {
  queryTextbookEditorServiceHandle,
  installTextbookEditorServiceHandle,
  logsTextbookEditorServiceHandle,
  removeTextbookEditorServiceHandle,
  startTextbookEditorServiceHandle,
  textbookEditorWebURL,
  haveNewVersionTextbookEditorServiceHandle,
  updateTextbookEditorServiceHandle,
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

// 全局变量存储textbookEditorWindow实例
let textbookEditorWindow: BrowserWindow | null = null;

export default async function init(ipcMain: IpcMain) {
  ipcHandle(ipcMain, queryTextbookEditorServiceHandle, async (_event) =>
    queryTextbookEditorService(),
  );
  ipcHandle(ipcMain, installTextbookEditorServiceHandle, async (_event) =>
    installTextbookEditorService(),
  );
  ipcHandle(ipcMain, startTextbookEditorServiceHandle, async (_event) =>
    startTextbookEditorService(),
  );
  ipcHandle(ipcMain, removeTextbookEditorServiceHandle, async (_event) =>
    removeTextbookEditorService(),
  );
  ipcHandle(ipcMain, logsTextbookEditorServiceHandle, async (_event) =>
    logsTextbookEditorService(),
  );
  ipcHandle(ipcMain, updateTextbookEditorServiceHandle, async (_event) =>
    updateTextbookEditorService(),
  );
  ipcHandle(
    ipcMain,
    haveNewVersionTextbookEditorServiceHandle,
    async (_event) => haveNewVersionTextbookEditorService(),
  );
}

const createWindow = (): void => {
  if (textbookEditorWindow && !textbookEditorWindow.isDestroyed()) {
    if (textbookEditorWindow.isMinimized()) {
      textbookEditorWindow.restore();
    }
    textbookEditorWindow.focus();
    return;
  }

  textbookEditorWindow = new BrowserWindow({
    height: 900,
    width: 1400,
    autoHideMenuBar: true,
  });

  textbookEditorWindow.loadURL(textbookEditorWebURL);

  textbookEditorWindow.on('closed', async () => {
    textbookEditorWindow = null;
    await stopService('TEXTBOOK_EDITOR');
  });
};

export async function queryTextbookEditorService() {
  return getServiceInfo('TEXTBOOK_EDITOR');
}

export async function installTextbookEditorService() {
  const installedInfo = await installService('TEXTBOOK_EDITOR');
  return installedInfo;
}

export async function removeTextbookEditorService() {
  try {
    textbookEditorWindow && textbookEditorWindow.close();
  } catch (e) {
    console.warn(e);
  }
  return uninstallService('TEXTBOOK_EDITOR');
}

export async function logsTextbookEditorService() {
  return getServiceLogs('TEXTBOOK_EDITOR');
}

export async function startTextbookEditorService() {
  const info = await startService('TEXTBOOK_EDITOR');
  if (info && info.state === 'running') {
    createWindow();
  } else {
    await monitorStateIsRuning('TEXTBOOK_EDITOR');
    createWindow();
  }
  return { someData: 'data1' };
}

/**
 * 检查本地版本是否落后于远程版本
 * 使用 git 对比本地 HEAD 和远程分支的最新 commit
 * @returns 如果本地落后则返回 true，否则返回 false
 */
export async function haveNewVersionTextbookEditorService(): Promise<{
  haveNew: boolean;
  currentVersion?: string;
  latestVersion?: string;
  error?: string;
}> {
  try {
    const serviceInfo = await getServiceInfo('TEXTBOOK_EDITOR');
    const currentVersion = serviceInfo.version;
    if (serviceInfo.state === 'not_install') {
      return { haveNew: false, error: '本地服务未安装' };
    }

    // 获取dlc信息中TEXTBOOK_EDITOR_SOURCE的最新版本
    let latestVersion = '0.0.0';
    try {
      const latestVersionInfo = getLatestVersion('TEXTBOOK_EDITOR_SOURCE', {});
      latestVersion = latestVersionInfo.version;
    } catch (error) {
      console.warn('获取TEXTBOOK_EDITOR_SOURCE最新版本失败:', error);
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
export async function updateTextbookEditorService() {
  // 先停止服务
  await stopService('TEXTBOOK_EDITOR');

  // 执行安装服务（会重新克隆并安装）
  const result = await installTextbookEditorService();

  return result;
}
