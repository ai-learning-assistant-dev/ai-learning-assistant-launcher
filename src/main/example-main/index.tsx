import { Event, IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  ActionName,
  channel,
  ExampleData,
  installExampleHandle,
  ServiceName,
} from './type-info';
import { Exec } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { wait } from '../util';
import { ipcHandle } from '../ipc-util';
const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName, vaultId: string) => {
      console.debug(
        `action: ${action}, serviceName: ${serviceName}, vaultId: ${vaultId}, channel: ${channel}`,
      );

      if (serviceName == 'all') {
        if (action === 'query') {
          const examples = await queryExampleData();
          event.reply(
            channel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName, examples),
          );
        }
      } else {
        if (action === 'install') {
          event.reply(
            channel,
            MESSAGE_TYPE.PROGRESS,
            `消息式开始安装${serviceName}`,
          );
          const result = await installExample(serviceName);
          if(result){
            event.reply(channel, MESSAGE_TYPE.INFO, `消息式安装${serviceName}成功`);
          }else{
            event.reply(channel, MESSAGE_TYPE.ERROR, `消息式安装${serviceName}失败`);
          }
        }
      }
    },
  );

  ipcHandle(ipcMain, installExampleHandle, async (_event, serviceName) => installExample(serviceName))
}


async function queryExampleData() {
  try {
    await wait(2000);
    const exampleData: ExampleData[] = [{name:"service1", status: 'good'}, {name:"service2", status: 'bad'}]
    console.debug('queryExampleData', exampleData);
    return exampleData;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function installExample(serviceName: ServiceName){
  await wait(2000);
  return {someData: "data1"};
}
