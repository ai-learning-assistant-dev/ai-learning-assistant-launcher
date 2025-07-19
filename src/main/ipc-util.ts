import { IpcMain, IpcMainInvokeEvent } from "electron";

export function ipcHandle(ipcMain: IpcMain, channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<void> | any): void {
  ipcMain.handle(channel, async (...args) => {
    try {
      return { result: await Promise.resolve(listener(...args)) };
    } catch (error) {
      // From error instance only message property will get through.
      // Sending non error instance as a message property of an object triggers
      // coercion of message property to String.
      return error instanceof Error ? { error } : { error: { message: error } };
    }
  });
}