import { ElectronHandler, MainHandle } from '../main/preload';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: ElectronHandler;
    mainHandle: MainHandle;
  }
}

export {};
