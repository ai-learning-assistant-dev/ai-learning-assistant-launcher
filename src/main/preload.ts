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
      if (channel === 'service-logs') {
        // 特殊处理 service-logs 频道
        const subscription = (_event: IpcRendererEvent, logData: any) => func(logData, '', ...arguments);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      } else if (channel === 'container-stopped') {
        // 特殊处理 container-stopped 频道
        const subscription = (_event: IpcRendererEvent, data: any) => func(data, '', ...arguments);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      } else {
        const subscription = (_event: IpcRendererEvent,messageType: MESSAGE_TYPE, data: MessageData<A, S, any>, ...args: unknown[]) =>
          func(messageType, data, ...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
    },
    once<A extends AllAction,S extends AllService>(channel: Channels, func: (action: A, serviceName: S,...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, action: A, serviceName: S,...args) => func(action, serviceName,...args));
    },
    invoke(channel: string, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args);
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
