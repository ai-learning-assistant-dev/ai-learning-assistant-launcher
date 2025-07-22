import { IpcMain } from 'electron';
import {
  ActionName,
  channel,
  LMModel,
  lmsGetNameDict,
  ServiceName,
} from './type-info';
import { Exec } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      console.debug(
        `lm-studio action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );

      if (serviceName == null) {
        if (action === 'query') {
          const models = await queryModelStatus();
          event.reply(
            channel,
            MESSAGE_TYPE.DATA,
            new MessageData(action, serviceName, models),
          );
        }
      } else {
        if (action === 'install') {
          event.reply(
            channel,
            MESSAGE_TYPE.PROGRESS,
            `开始下载模型${serviceName}，下载时间受网速和模型大小影响，您可以打开LMStudio软件查看下载进度`,
          );
          const result = await installModel(serviceName);
          event.reply(channel, MESSAGE_TYPE.INFO, `下载模型${serviceName}成功`);
        }
        if (action === 'start') {
          event.reply(
            channel,
            MESSAGE_TYPE.PROGRESS,
            `开始下载模型${serviceName}，下载时间受网速和模型大小影响，您可以打开LMStudio软件查看下载进度`,
          );
          const result = await installModel(serviceName);
          event.reply(channel, MESSAGE_TYPE.INFO, `下载模型${serviceName}成功`);
        }
      }
    },
  );
}

async function queryModelStatus() {
  try {
    const result = await commandLine.exec('lms', ['ls', '--json'], {
      shell: true,
    });
    console.debug('queryModelStatus', result);
    return JSON.parse(result.stdout) as LMModel[];
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function installModel(serviceName: ServiceName) {
  try {
    const result = await commandLine.exec(
      'lms',
      ['get', lmsGetNameDict[serviceName], '--yes'],
      {
        shell: true,
      },
    );
    console.debug('installModel', result);
    return result;
  } catch (e) {
    console.error(e);
    throw e;
  }
}
