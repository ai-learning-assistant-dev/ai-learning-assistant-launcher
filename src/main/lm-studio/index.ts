import { dialog, IpcMain } from 'electron';
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
import { loggerFactory } from '../terminal-log';
import path from 'path';
import { fixModelList } from './lmstudio-paths';
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
            if (serviceName.indexOf('ala') === 0) {
              const { success, errorMessage } = await importModel(serviceName);
              event.reply(
                channel,
                success ? MESSAGE_TYPE.INFO : MESSAGE_TYPE.ERROR,
                errorMessage,
              );
            } else {
              event.reply(
                channel,
                MESSAGE_TYPE.PROGRESS,
                `开始下载模型${serviceName}，下方日志区可查看下载进度。`,
              );
              const result = await installModel(serviceName);
              event.reply(
                channel,
                MESSAGE_TYPE.INFO,
                `下载模型${serviceName}成功`,
              );
            }
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
              `开始停止模型${serviceName}`,
            );
            try {
              const result = await stopModel(serviceName);
              event.reply(
                channel,
                MESSAGE_TYPE.INFO,
                `停止模型${serviceName}成功`,
              );
            } catch (e) {
              console.warn(e);
              if (e && e.message && e.message.indexOf('already') >= 0) {
                event.reply(
                  channel,
                  MESSAGE_TYPE.ERROR,
                  `模型${serviceName}已经停止`,
                );
              } else {
                event.reply(
                  channel,
                  MESSAGE_TYPE.ERROR,
                  `模型${serviceName}停止错误`,
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
    const result = await Promise.race([
      new Promise<RunResult>((resolve, reject) =>
        setTimeout(() => reject('queryModelStatus命令超时'), 15000),
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
        encoding: 'utf8',
        logger: loggerFactory(serviceName),
      },
    );
    console.debug('installModel', result);
    return result;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function importModel(serviceName: ServiceName) {
  let errorMessage = '导入成功';
  let success = false;
  const result = await dialog.showOpenDialog({
    title: '选择模型文件',
    properties: ['openFile', 'showHiddenFiles'],
    filters: [{ name: modelNameDict[serviceName], extensions: ['gguf'] }],
  });
  const pathStr = result.filePaths[0];
  if (pathStr && pathStr.length > 0) {
    try {
      console.debug('importModel basename', path.basename(pathStr));
      if (
        path.basename(pathStr) != `${modelNameDict[serviceName]}.gguf` &&
        path.basename(pathStr) != `${modelNameDict[serviceName]}.GGUF`
      ) {
        errorMessage = `必须选择文件名为${modelNameDict[serviceName]}.gguf的文件`;
        return { success, errorMessage };
      }
      const result = await commandLine.exec(
        'lms',
        ['import', path.join(pathStr), '--copy', '--user-repo', serviceName],
        {
          encoding: 'utf8',
          logger: loggerFactory(serviceName),
        },
      );
      console.debug('importModel', result);
      try {
        // TODO 要关注LM Studio更新对这里的影响
        fixModelList(`${serviceName}/${modelNameDict[serviceName]}`);
      } catch (error) {
        console.warn('importModel fixModelList', result);
      }
      success = true;
    } catch (e) {
      console.error(e);
      success = false;
      errorMessage = '导入失败';
    }
  } else {
    errorMessage = '没有选择正确的文件';
  }
  return { success, errorMessage };
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
