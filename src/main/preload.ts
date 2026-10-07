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
  haveNewVersionNativeTrainingServiceHandle,
  installNativeTrainingServiceHandle,
  logsNativeTrainingServiceHandle,
  queryNativeTrainingServiceHandle,
  removeNativeTrainingServiceHandle,
  startNativeTrainingServiceHandle,
  updateCourseNativeTrainingServiceHandle,
  updateNativeTrainingServiceHandle,
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
import {
  queryNativeTrainingConfigHandle,
  setNativeTrainingConfigHandle,
  TrainingConfig,
} from './configs/type-info';
import { haveNewVersionTextbookEditorServiceHandle, installTextbookEditorServiceHandle, logsTextbookEditorServiceHandle, queryTextbookEditorServiceHandle, removeTextbookEditorServiceHandle, startTextbookEditorServiceHandle, updateTextbookEditorServiceHandle } from './textbook-editor-service/type-info';
import {
  installOpenclawServiceHandle,
  queryOpenclawServiceHandle,
  removeOpenclawServiceHandle,
  runOpenclawServiceHandle,
  stopOpenclawServiceHandle,
  openOpenclawWindowHandle,
  copyOpenclawDashboardUrlHandle,
  OpenclawServiceInfo,
} from './openclaw-service/type-info';
import {
  installDeepseekHarnessServiceHandle,
  queryDeepseekHarnessServiceHandle,
  removeDeepseekHarnessServiceHandle,
  runDeepseekHarnessServiceHandle,
  stopDeepseekHarnessServiceHandle,
  openDeepseekHarnessWindowHandle,
  copyDeepseekHarnessDashboardUrlHandle,
  syncWorkbuddyModelsToDshHandle,
  openDeepseekHarnessBackupDirHandle,
  DeepseekHarnessServiceInfo,
  WorkbuddyModelSyncResult,
} from './deepseek-harness-service/type-info';
import { openBunDebugHandle } from './bun-debug/type-info';
import {
  llmFreeQueryConfigHandle,
  llmFreeSetConfigHandle,
  llmFreeStartHandle,
  llmFreeStopHandle,
  llmFreeStatusHandle,
  llmFreeRegenerateKeyHandle,
  llmFreeProbeHandle,
  llmFreeCatalogHandle,
  llmFreeModelsHandle,
} from './llm-free/type-info';
import type {
  FreeProviderConfig,
  FreeProviderStatus,
} from './llm-free/type-info';

const electronHandler = {
  // 系统信息
  platform: process.platform, // 'win32' | 'darwin' | 'linux'
  arch: process.arch, // 'x64' | 'arm64' | etc.
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
  queryNativeTrainingConfigHandle: async () => {
    return ipcInvoke<TrainingConfig>(queryNativeTrainingConfigHandle);
  },
  setNativeTrainingConfigHandle: async (config: TrainingConfig) => {
    return ipcInvoke<TrainingConfig>(setNativeTrainingConfigHandle, config);
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
  updateNativeTrainingServiceHandle: async () => {
    return ipcInvoke(updateNativeTrainingServiceHandle);
  },
  haveNewVersionNativeTrainingServiceHandle: async () => {
    return ipcInvoke<{
      currentVersion: string;
      latestVersion: string;
      haveNew: boolean;
    }>(haveNewVersionNativeTrainingServiceHandle);
  },
  logsNativeTrainingServiceHandle: async () => {
    return ipcInvoke<{ imageId: string; logs: string }>(
      logsNativeTrainingServiceHandle,
    );
  },
  queryTextbookEditorServiceHandle: async () => {
    return ipcInvoke<NativeServiceInfo>(queryTextbookEditorServiceHandle);
  },
  installTextbookEditorServiceHandle: async () => {
    return ipcInvoke(installTextbookEditorServiceHandle);
  },
  startTextbookEditorServiceHandle: async () => {
    return ipcInvoke(startTextbookEditorServiceHandle);
  },
  removeTextbookEditorServiceHandle: async () => {
    return ipcInvoke(removeTextbookEditorServiceHandle);
  },
  logsTextbookEditorServiceHandle: async () => {
    return ipcInvoke<{ imageId: string; logs: string }>(
      logsTextbookEditorServiceHandle,
    );
  },
  updateTextbookEditorServiceHandle: async () => {
    return ipcInvoke(updateTextbookEditorServiceHandle);
  },
  haveNewVersionTextbookEditorServiceHandle: async () => {
    return ipcInvoke<{
      currentVersion: string;
      latestVersion: string;
      haveNew: boolean;
    }>(haveNewVersionTextbookEditorServiceHandle);
  },
  queryOpenclawServiceHandle: async () => {
    return ipcInvoke<OpenclawServiceInfo>(queryOpenclawServiceHandle);
  },
  installOpenclawServiceHandle: async () => {
    return ipcInvoke<OpenclawServiceInfo>(installOpenclawServiceHandle);
  },
  removeOpenclawServiceHandle: async () => {
    return ipcInvoke<OpenclawServiceInfo>(removeOpenclawServiceHandle);
  },
  runOpenclawServiceHandle: async () => {
    return ipcInvoke<OpenclawServiceInfo>(runOpenclawServiceHandle);
  },
  stopOpenclawServiceHandle: async () => {
    return ipcInvoke<OpenclawServiceInfo>(stopOpenclawServiceHandle);
  },
  openOpenclawWindowHandle: async () => {
    return ipcInvoke<OpenclawServiceInfo>(openOpenclawWindowHandle);
  },
  copyOpenclawDashboardUrlHandle: async () => {
    return ipcInvoke<string>(copyOpenclawDashboardUrlHandle);
  },
  queryDeepseekHarnessServiceHandle: async () => {
    return ipcInvoke<DeepseekHarnessServiceInfo>(
      queryDeepseekHarnessServiceHandle,
    );
  },
  installDeepseekHarnessServiceHandle: async () => {
    return ipcInvoke<DeepseekHarnessServiceInfo>(
      installDeepseekHarnessServiceHandle,
    );
  },
  removeDeepseekHarnessServiceHandle: async () => {
    return ipcInvoke<DeepseekHarnessServiceInfo>(
      removeDeepseekHarnessServiceHandle,
    );
  },
  runDeepseekHarnessServiceHandle: async () => {
    return ipcInvoke<DeepseekHarnessServiceInfo>(
      runDeepseekHarnessServiceHandle,
    );
  },
  stopDeepseekHarnessServiceHandle: async () => {
    return ipcInvoke<DeepseekHarnessServiceInfo>(
      stopDeepseekHarnessServiceHandle,
    );
  },
  openDeepseekHarnessWindowHandle: async () => {
    return ipcInvoke<DeepseekHarnessServiceInfo>(
      openDeepseekHarnessWindowHandle,
    );
  },
  copyDeepseekHarnessDashboardUrlHandle: async () => {
    return ipcInvoke<string>(copyDeepseekHarnessDashboardUrlHandle);
  },
  // 把 WorkBuddy 的模型配置同步进 DeepSeek Harness（写入前自动备份 dsh 配置）
  syncWorkbuddyModelsToDshHandle: async () => {
    return ipcInvoke<WorkbuddyModelSyncResult>(syncWorkbuddyModelsToDshHandle);
  },
  // 在系统文件管理器里打开 dsh 配置的备份目录
  openDeepseekHarnessBackupDirHandle: async (dir?: string) => {
    return ipcInvoke<string>(openDeepseekHarnessBackupDirHandle, dir);
  },
  openBunDebugHandle: async () => {
    return ipcInvoke<void>(openBunDebugHandle);
  },
  // ── 免密免费模型（Zen free lane）──
  llmFreeQueryConfig: async (): Promise<FreeProviderConfig> => {
    return ipcInvoke<FreeProviderConfig>(llmFreeQueryConfigHandle);
  },
  llmFreeSetConfig: async (
    patch: Partial<FreeProviderConfig>,
  ): Promise<FreeProviderConfig> => {
    return ipcInvoke<FreeProviderConfig>(llmFreeSetConfigHandle, patch);
  },
  llmFreeStart: async (): Promise<void> => {
    return ipcInvoke<void>(llmFreeStartHandle);
  },
  llmFreeStop: async (): Promise<void> => {
    return ipcInvoke<void>(llmFreeStopHandle);
  },
  llmFreeStatus: async (): Promise<FreeProviderStatus> => {
    return ipcInvoke<FreeProviderStatus>(llmFreeStatusHandle);
  },
  llmFreeRegenerateKey: async (): Promise<string> => {
    return ipcInvoke<string>(llmFreeRegenerateKeyHandle);
  },
  llmFreeProbe: async (): Promise<Record<string, unknown>> => {
    return ipcInvoke<Record<string, unknown>>(llmFreeProbeHandle);
  },
  llmFreeCatalog: async (): Promise<{
    entries: Array<Record<string, unknown>>;
    membership: Record<string, string[]>;
  }> => {
    return ipcInvoke(llmFreeCatalogHandle);
  },
  llmFreeModels: async (): Promise<Array<Record<string, unknown>>> => {
    return ipcInvoke<Array<Record<string, unknown>>>(llmFreeModelsHandle);
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
