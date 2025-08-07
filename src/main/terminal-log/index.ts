import { BrowserWindow } from 'electron';
import { channel } from './type-info';
import { AllService, MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { Logger } from '@podman-desktop/api';

let window: BrowserWindow | null = null;
export default function init(mainWindow: BrowserWindow) {
  window = mainWindow;
}

export function write(service: AllService | undefined, data: any) {
  // console.debug('terminal-log', service, data);
  window &&
    window.webContents.send(
      channel,
      MESSAGE_TYPE.DATA,
      new MessageData('query', service, data),
    );
}

export function loggerFactory(service: AllService) {
  const logger: Logger = {
    log(...data) {
      write(service, data[0]);
    },
    error(...data): void {
      write(service, data[0]);
    },
    warn(...data): void {
      write(service, data[0]);
    },
  };
  return logger;
}
