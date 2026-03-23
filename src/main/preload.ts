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
} from './dlc/type-info';
import {
  checkLauncherUpdateHandle,
  downloadLauncherUpdateHandle,
  installLauncherUpdateHandle,
} from './launcher-update/type-info';

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
};

export type MainHandle = typeof mainHandle;

export function initExposure(): void {
  contextBridge.exposeInMainWorld('mainHandle', mainHandle);
}

initExposure();
