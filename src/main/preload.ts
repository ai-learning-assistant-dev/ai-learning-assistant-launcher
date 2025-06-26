// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { AllAction, AllService, Channels, MESSAGE_TYPE, MessageData } from './ipc-data-type';


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
