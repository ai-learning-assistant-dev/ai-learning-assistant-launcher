// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  AllAction,
  AllService,
  Channels,
  MESSAGE_TYPE,
  MessageData,
} from './ipc-data-type';
import 'electron-log/preload';
import {
  installExampleHandle,
  ServiceName as ServiceNameExample,
} from './example-main/type-info';
import {
  installTrainingServiceHandle,
  logsTrainingServiceHandle,
  removeTrainingServiceHandle,
  updateCourseTrainingServiceHandle,
  startTrainingServiceHandle,
  courseHaveNewVersionTrainingServiceHandle,
} from './training-service/type-info';
import {
  selectFolderHandle,
  getDiskInfoHandle,
  setTrayEnabledHandle,
  DiskInfo,
} from './joint-build/type-info';
import {
  DLCIndex,
  logsWebtorrentHandle,
  pauseWebtorrentHandle,
  queryWebtorrentHandle,
  removeWebtorrentHandle,
  startWebtorrentHandle,
  DLCId,
  setUploadEnabledHandle,
  getUploadEnabledHandle,
  getUploadStatsHandle,
  startHttpsDownloadHandle,
  queryHttpsDownloadHandle,
  cancelHttpsDownloadHandle,
  checkHttpsDownloadFileHandle,
  HttpsDownloadState,
} from './dlc/type-info';
import {
  checkLauncherUpdateHandle,
  downloadLauncherUpdateHandle,
  installLauncherUpdateHandle,
} from './launcher-update/type-info';
import {
  courseHaveNewVersionNativeTrainingServiceHandle,
  installNativeTrainingServiceHandle,
  logsNativeTrainingServiceHandle,
  queryNativeTrainingServiceHandle,
  removeNativeTrainingServiceHandle,
  startNativeTrainingServiceHandle,
  updateCourseNativeTrainingServiceHandle,
} from './native-training-service/type-info';
import { NativeServiceInfo } from './native-script/type-info';
import {
  installRTSServiceHandle,
  getRTSServiceStatusHandle,
  runRTSServiceHandle,
  stopRTSServiceHandle,
  rtsProgressChannel,
  RTSProgressInfo,
} from './local-service/rts-service/type-info';
import {
  getObsidianVoiceServiceStatusHandle,
  installObsidianVoiceServiceHandle,
  runObsidianVoiceServiceHandle,
  stopObsidianVoiceServiceHandle,
} from './local-service/obsidian-voice-service/type-info';

const electronHandler = {
  ipcRenderer: {
    sendMessage<A extends AllAction, S extends AllService>(
      channel: Channels,
      action: A,
      serviceName?: S,
      ...args: unknown[]
    ) {
      ipcRenderer.send(channel, action, serviceName, ...args);
    },
    on<A extends AllAction, S extends AllService>(
      channel: Channels,
      func: (
        messageType: MESSAGE_TYPE,
        data: MessageData<A, S, any> | string,
        ...args: unknown[]
      ) => void,
    ) {
      const subscription = (
        _event: IpcRendererEvent,
        messageType: MESSAGE_TYPE,
        data: MessageData<A, S, any>,
        ...args: unknown[]
      ) => func(messageType, data, ...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once<A extends AllAction, S extends AllService>(
      channel: Channels,
      func: (action: A, serviceName: S, ...args: unknown[]) => void,
    ) {
      ipcRenderer.once(channel, (_event, action: A, serviceName: S, ...args) =>
        func(action, serviceName, ...args),
      );
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;

interface ErrorMessage {
  name: string;
  message: string;
  extra: unknown;
}

function decodeError(error: ErrorMessage): Error {
  const e = new Error(error.message);
  e.name = error.name;
  Object.assign(e, error.extra);
  return e;
}

async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const { error, result } = await ipcRenderer.invoke(channel, ...args);
  if (error) {
    throw decodeError(error);
  }
  return result;
}

/** 比ipcRenderer.send多了返回值，更接近正常的函数调用，不需要在另一个监听事件中异步监听
 * 适合于renderer代码要按照顺序调用很多个main中的函数的情况，也适合不需要吧操作结果广播到其他模块的场景
 */
const mainHandle = {
  installExampleHandle: async (
    service: ServiceNameExample,
  ): Promise<boolean> => {
    return ipcInvoke(installExampleHandle, service);
  },
  installTrainingServiceHandle: async () => {
    return ipcInvoke(installTrainingServiceHandle);
  },
  startTrainingServiceHandle: async () => {
    return ipcInvoke(startTrainingServiceHandle);
  },
  removeTrainingServiceHandle: async () => {
    return ipcInvoke(removeTrainingServiceHandle);
  },
  updateCourseTrainingServiceHandle: async () => {
    return ipcInvoke(updateCourseTrainingServiceHandle);
  },
  courseHaveNewVersionTrainingServiceHandle: async () => {
    return ipcInvoke<{
      currentVersion: string;
      latestVersion: string;
      haveNew: boolean;
    }>(courseHaveNewVersionTrainingServiceHandle);
  },
  logsTrainingServiceHandle: async () => {
    return ipcInvoke<{ imageId: string; logs: string }>(
      logsTrainingServiceHandle,
    );
  },
  queryNativeTrainingServiceHandle: async () => {
    return ipcInvoke<NativeServiceInfo>(queryNativeTrainingServiceHandle);
  },
  installNativeTrainingServiceHandle: async () => {
    return ipcInvoke(installNativeTrainingServiceHandle);
  },
  startNativeTrainingServiceHandle: async () => {
    return ipcInvoke(startNativeTrainingServiceHandle);
  },
  removeNativeTrainingServiceHandle: async () => {
    return ipcInvoke(removeNativeTrainingServiceHandle);
  },
  updateCourseNativeTrainingServiceHandle: async () => {
    return ipcInvoke(updateCourseNativeTrainingServiceHandle);
  },
  courseHaveNewVersionNativeTrainingServiceHandle: async () => {
    return ipcInvoke<{
      currentVersion: string;
      latestVersion: string;
      haveNew: boolean;
    }>(courseHaveNewVersionNativeTrainingServiceHandle);
  },
  logsNativeTrainingServiceHandle: async () => {
    return ipcInvoke<{ imageId: string; logs: string }>(
      logsNativeTrainingServiceHandle,
    );
  },
  // 共建计划相关
  selectJointBuildFolder: async (): Promise<string | null> => {
    return ipcInvoke(selectFolderHandle);
  },
  getJointBuildDiskInfo: async (diskPath: string): Promise<DiskInfo> => {
    return ipcInvoke(getDiskInfoHandle, diskPath);
  },
  setTrayEnabled: async (enabled: boolean): Promise<boolean> => {
    return ipcInvoke(setTrayEnabledHandle, enabled);
  },
  // 托盘菜单事件监听
  onNavigateTo: (callback: (route: string) => void) => {
    const handler = (_event: IpcRendererEvent, route: string) =>
      callback(route);
    ipcRenderer.on('navigate-to', handler);
    return () => ipcRenderer.removeListener('navigate-to', handler);
  },
  onJointBuildStatusChanged: (callback: (enabled: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, enabled: boolean) =>
      callback(enabled);
    ipcRenderer.on('joint-build-status-changed', handler);
    return () =>
      ipcRenderer.removeListener('joint-build-status-changed', handler);
  },
  startWebtorrentHandle: async (url: string) => {
    return ipcInvoke<
      { success: true; infoHash: string } | { success: false; error: string }
    >(startWebtorrentHandle, url);
  },
  queryWebtorrentHandle: async () => {
    return ipcInvoke<DLCIndex>(queryWebtorrentHandle);
  },
  pauseWebtorrentHandle: async (url: string) => {
    return ipcInvoke(pauseWebtorrentHandle, url);
  },
  installRTSServiceHandle: async (): Promise<string> => {
    return ipcInvoke(installRTSServiceHandle);
  },
  getRTSServiceStatusHandle: async (): Promise<string> => {
    return ipcInvoke(getRTSServiceStatusHandle);
  },
  runRTSServiceHandle: async (): Promise<string> => {
    return ipcInvoke(runRTSServiceHandle);
  },
  stopRTSServiceHandle: async (): Promise<string> => {
    return ipcInvoke(stopRTSServiceHandle);
  },
  installObsidianVoiceServiceHandle: async (): Promise<string> => {
    return ipcInvoke(installObsidianVoiceServiceHandle);
  },
  getObsidianVoiceServiceStatusHandle: async (): Promise<string> => {
    return ipcInvoke(getObsidianVoiceServiceStatusHandle);
  },
  runObsidianVoiceServiceHandle: async (): Promise<string> => {
    return ipcInvoke(runObsidianVoiceServiceHandle);
  },
  stopObsidianVoiceServiceHandle: async (): Promise<string> => {
    return ipcInvoke(stopObsidianVoiceServiceHandle);
  },
  removeWebtorrentHandle: async (url: string) => {
    return ipcInvoke(removeWebtorrentHandle, url);
  },
  logsWebtorrentHandle: async (url: string) => {
    return ipcInvoke(logsWebtorrentHandle, url);
  },
  checkLauncherUpdateHandle: async () => {
    return ipcInvoke<{
      currentVersion: string;
      latestVersion: string;
      haveNew: boolean;
    }>(checkLauncherUpdateHandle);
  },
  downloadLauncherUpdateHandle: async () => {
    return ipcInvoke<{
      success: boolean;
      version: string;
      filePath: string;
      isDev: boolean;
    }>(downloadLauncherUpdateHandle);
  },
  installLauncherUpdateHandle: async () => {
    return ipcInvoke<{
      success: boolean;
      message: string;
    }>(installLauncherUpdateHandle);
  },
  setUploadEnabledHandle: async (enabled: boolean) => {
    return ipcInvoke<{ success: boolean; enabled: boolean }>(
      setUploadEnabledHandle,
      enabled,
    );
  },
  getUploadEnabledHandle: async () => {
    return ipcInvoke<{ enabled: boolean }>(getUploadEnabledHandle);
  },
  getUploadStatsHandle: async () => {
    return ipcInvoke<{
      enabled: boolean;
      totalUploaded: number;
      uploadSpeed: number;
      activeTorrents: number;
    }>(getUploadStatsHandle);
  },
  // HTTPS 多源下载
  startHttpsDownloadHandle: async (
    dlcId: DLCId,
    urls: string[],
    version: string,
  ) => {
    return ipcInvoke<{ success: boolean; error?: string }>(
      startHttpsDownloadHandle,
      dlcId,
      urls,
      version,
    );
  },
  queryHttpsDownloadHandle: async () => {
    return ipcInvoke<HttpsDownloadState>(queryHttpsDownloadHandle);
  },
  cancelHttpsDownloadHandle: async (dlcId: DLCId) => {
    return ipcInvoke<{ success: boolean }>(cancelHttpsDownloadHandle, dlcId);
  },
  checkHttpsDownloadFileHandle: async (dlcId: DLCId, version: string) => {
    return ipcInvoke<{ exists: boolean; filePath: string | null }>(
      checkHttpsDownloadFileHandle,
      dlcId,
      version,
    );
  },
  // RTS 进度事件监听
  onRtsProgress: (callback: (progress: RTSProgressInfo) => void) => {
    const handler = (_event: IpcRendererEvent, progress: RTSProgressInfo) => {
      callback(progress);
    };
    ipcRenderer.on(rtsProgressChannel, handler);
    return () => {
      ipcRenderer.removeListener(rtsProgressChannel, handler);
    };
  },
};

export type MainHandle = typeof mainHandle;

export function initExposure(): void {
  contextBridge.exposeInMainWorld('mainHandle', mainHandle);
}

initExposure();
