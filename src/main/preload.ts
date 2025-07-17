// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { AllAction, AllService, Channels, MESSAGE_TYPE, MessageData } from './ipc-data-type';
import 'electron-log/preload';

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

export function initExposure(): void {
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

  /** 比ipcRenderer.send多了返回值，更接近正常的函数调用，不需要在另一个监听事件中异步监听
   * 适合于renderer代码要按照顺序调用很多个main中的函数的情况
   * 缺点1是mian的代码的报错会直接导致renderer崩溃;
   * 2是会允许把一个业务的代码分散放在renderer和main中，导致增加开发者写出垃圾的代码的可能性。
   */
  async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const { error, result } = await ipcRenderer.invoke(channel, ...args);
    if (error) {
      throw decodeError(error);
    }
    return result;
  }

  contextBridge.exposeInMainWorld(
    'extensionSystemIsExtensionsStarted',
    async (): Promise<boolean> => {
      return ipcInvoke('extension-system:isExtensionsStarted');
  });
}

initExposure();
