import { ElectronHandler, MainHandle } from '../main/preload';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: ElectronHandler;
    mainHandle: MainHandle;
  }
  /** 编译所用的代码版本号 */
  const __COMMIT_HASH__: string;
  /** 产品版本号 */
  const __NPM_PACKAGE_VERSION__: string;
}

export {};
