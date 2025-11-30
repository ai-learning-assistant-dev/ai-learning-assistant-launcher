import { ipcMain, shell } from 'electron';
import { MESSAGE_TYPE } from '../ipc-data-type';

export default function initExternalUrl(ipcMain: Electron.IpcMain) {
  // 监听 open-external-url 消息
  ipcMain.on('open-external-url', (event, action, service, url) => {
    if (action === 'open' && service === 'browser' && url && typeof url === 'string') {
      shell.openExternal(url);
    }
  });
}