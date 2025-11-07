// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { AllAction, AllService, Channels, MESSAGE_TYPE, MessageData } from './ipc-data-type';
import 'electron-log/preload';
import { installExampleHandle, ServiceName as ServiceNameExample } from './example-main/type-info';
import { startTrainingServiceHandle } from './training-service/type-info';

const electronHandler = {
  ipcRenderer: {
    sendMessage<A extends AllAction,S extends AllService>(channel: Channels, action: A, serviceName?: S,...args: unknown[]) {
      ipcRenderer.send(channel, action, serviceName, ...args);
    },
    on<A extends AllAction,S extends AllService>(channel: Channels, func: (messageType: MESSAGE_TYPE, data: MessageData<A, S, any> | string, ...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent,messageType: MESSAGE_TYPE, data: MessageData<A, S, any>, ...args: unknown[]) =>
        func(messageType, data, ...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once<A extends AllAction,S extends AllService>(channel: Channels, func: (action: A, serviceName: S,...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, action: A, serviceName: S,...args) => func(action, serviceName,...args));
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
  installExampleHandle: async (service: ServiceNameExample): Promise<boolean> => {
    return ipcInvoke(installExampleHandle, service);
  },
  startTrainingServiceHandle: async () => {
    return ipcInvoke(startTrainingServiceHandle);
  }
}

export type MainHandle = typeof mainHandle;

export function initExposure(): void {
  contextBridge.exposeInMainWorld(
    'mainHandle',
    mainHandle
  );

}

initExposure();
