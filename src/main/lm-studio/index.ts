import { IpcMain } from 'electron';
import {
  ActionName,
  channel,
  LMModel,
  lmsGetNameDict,
  modelNameDict,
  ServerStatus,
  ServiceName,
} from './type-info';
import { Exec } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { RunResult } from '@podman-desktop/api';
const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      console.debug(
        `lm-studio action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      try {
        if (serviceName == null) {
          if (action === 'query') {
            try {
              const models = await queryModelStatus();
              const serverStatus = await queryServerStatus();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, { serverStatus, models }),
              );
            } catch (e) {
              console.warn(e);
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  serverStatus: { port: 1234, running: false } as ServerStatus,
                  models: [],
                }),
              );
            }
          }
        } else {
          if (action === 'install') {
            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              `开始下载模型${serviceName}，下载时间受网速和模型大小影响，您可以打开LMStudio软件查看下载进度`,
            );
            const result = await installModel(serviceName);
            event.reply(
              channel,
              MESSAGE_TYPE.INFO,
              `下载模型${serviceName}成功`,
            );
          } else if (action === 'start') {
            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              `开始加载模型${serviceName}`,
            );
            try {
              const result = await startModel(serviceName);
              event.reply(
                channel,
                MESSAGE_TYPE.INFO,
                `加载模型${serviceName}成功`,
              );
            } catch (e) {
              console.warn(e);
              if (e && e.message && e.message.indexOf('already') >= 0) {
                event.reply(
                  channel,
                  MESSAGE_TYPE.INFO,
                  `加载模型${serviceName}成功`,
                );
              } else {
                event.reply(
                  channel,
                  MESSAGE_TYPE.ERROR,
                  `模型${serviceName}加载错误`,
                );
                throw e;
              }
            }
          } else if (action === 'stop') {
            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              `开始卸载模型${serviceName}`,
            );
            try {
              const result = await stopModel(serviceName);
              event.reply(
                channel,
                MESSAGE_TYPE.INFO,
                `卸载模型${serviceName}成功`,
              );
            } catch (e) {
              console.warn(e);
              if (e && e.message && e.message.indexOf('already') >= 0) {
                event.reply(
                  channel,
                  MESSAGE_TYPE.ERROR,
                  `模型${serviceName}已经卸载`,
                );
              } else {
                event.reply(
                  channel,
                  MESSAGE_TYPE.ERROR,
                  `模型${serviceName}卸载错误`,
                );
                throw e;
              }
            }
          }
        }
      } catch (e) {
        console.error(e);
        event.reply(channel, MESSAGE_TYPE.ERROR, '操作出错');
      }
    },
  );
}

async function queryServerStatus() {
  const serverStatusResult = await commandLine.exec(
    'lms',
    ['server', 'status', '--json', '--quiet'],
    {
      shell: true,
    },
  );
  const serverStatus = JSON.parse(serverStatusResult.stdout) as ServerStatus;
  return serverStatus;
}

async function queryModelStatus() {
  try {
    const result = await await Promise.race([
      new Promise<RunResult>((resolve, reject) =>
        setTimeout(() => reject('queryModelStatus命令超时'), 4000),
      ),
      commandLine.exec('lms', ['ls', '--json'], {
        shell: true,
      }),
    ]);
    const result2 = await commandLine.exec('lms', ['ps', '--json'], {
      shell: true,
    });

    const downloadedModel = JSON.parse(result.stdout) as LMModel[];
    const loadedModel = JSON.parse(result2.stdout) as LMModel[];
    for (const model of downloadedModel) {
      if (loadedModel.findIndex((m) => m.modelKey === model.modelKey) >= 0) {
        model.isLoaded = true;
      } else {
        model.isLoaded = false;
      }
    }

    console.debug('queryModelStatus', result);
    return downloadedModel;
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

async function startModel(serviceName: ServiceName) {
  await startLMStudioServer();
  try {
    const modelInfo = await getModelInfoByServiceName(serviceName);
    const result = await commandLine.exec(
      'lms',
      ['load', modelInfo.path, '--identifier', modelInfo.modelKey],
      {
        shell: true,
      },
    );
    console.debug('startModel', result);
    return result;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function getModelInfoByServiceName(serviceName: ServiceName) {
  const result = await commandLine.exec('lms', ['ls', '--json'], {
    shell: true,
  });
  console.debug('getModelKeyByServiceName', result);
  return (JSON.parse(result.stdout) as LMModel[]).filter(
    (item) => item.displayName === modelNameDict[serviceName],
  )[0];
}

async function stopModel(serviceName: ServiceName) {
  try {
    const modelInfo = await getModelInfoByServiceName(serviceName);
    const result = await commandLine.exec(
      'lms',
      ['unload', modelInfo.modelKey],
      {
        shell: true,
      },
    );
    console.debug('stopModel', result);
    return result;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export async function startLMStudioServer() {
  try {
    const serverResult = await commandLine.exec(
      'lms',
      ['server', 'start', '--cors'],
      {
        shell: true,
      },
    );
    console.debug('startServer', serverResult);
  } catch (e) {
    console.warn(e);
  }
}

export async function stopLMStudioServer() {
  try {
    const serverResult = await commandLine.exec('lms', ['server', 'stop'], {
      shell: true,
    });
    console.debug('startServer', serverResult);
  } catch (e) {
    console.warn(e);
  }
}
