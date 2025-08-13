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
import { loggerFactory, write } from '../terminal-log';
const commandLine = new Exec();

// 添加一个存储正在运行任务的 Map
const runningTasks = new Map<string, SimpleCancellationToken>();

// 创建一个简单的取消令牌实现
class SimpleCancellationToken {
  private _isCancelled = false;
  private _callbacks: (() => void)[] = [];

  public get isCancelled() {
    return this._isCancelled;
  }

  public onCancellationRequested(callback: () => void) {
    if (this._isCancelled) {
      callback();
    } else {
      this._callbacks.push(callback);
    }
  }

  public cancel() {
    this._isCancelled = true;
    this._callbacks.forEach(callback => callback());
    this._callbacks = [];
  }
}

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
          // 添加对取消动作的处理
          if (action === 'cancel') {
            const taskId = `install-${serviceName}`;
            console.log(`收到取消请求: ${taskId}`);
            const cancelToken = runningTasks.get(taskId);
            if (cancelToken) {
              console.log(`找到任务并执行取消: ${taskId}`);
              cancelToken.cancel();
              runningTasks.delete(taskId);
              // 发送日志消息指示下载已被取消
              write(serviceName, '\n--- 下载已取消 ---\n');
              // event.reply(
              //   channel,
              //   MESSAGE_TYPE.WARNING,
              //   `正在取消下载模型${serviceName}...`,
              // );
              return; // 处理完取消请求后直接返回
            } else {
              console.log(`未找到任务: ${taskId}`);
              event.reply(
                channel,
                MESSAGE_TYPE.WARNING,
                `没有找到正在下载的模型${serviceName}任务`,
              );
              return;
            }
          }

          // 在安装操作中添加任务管理
          if (action === 'install') {
            const taskId = `install-${serviceName}`;
            console.log(`开始安装任务: ${taskId}`);
            // 检查是否已经有相同的任务在运行
            if (runningTasks.has(taskId)) {
              console.log(`任务已在运行: ${taskId}`);
              event.reply(
                channel,
                MESSAGE_TYPE.WARNING,
                `模型${serviceName}已在下载中，请勿重复操作`,
              );
              return;
            }

            // 创建新的取消令牌并存储
            const cancelToken = new SimpleCancellationToken();
            runningTasks.set(taskId, cancelToken);
            console.log(`任务已创建并存储: ${taskId}`);

            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              `开始下载模型${serviceName}，下方日志区可查看下载进度。`,
            );

            try {
              const result = await installModel(serviceName, cancelToken);
              // 任务完成后从Map中移除
              runningTasks.delete(taskId);
              console.log(`任务成功完成并移除: ${taskId}`);
              event.reply(
                channel,
                MESSAGE_TYPE.INFO,
                `下载模型${serviceName}成功`,
              );
            } catch (e) {
              // 任务完成后从Map中移除
              runningTasks.delete(taskId);
              console.log(`任务失败并移除: ${taskId}`);
              // 检查是否是取消操作导致的异常
              if (cancelToken.isCancelled) {
                console.log(`任务被取消: ${taskId}`);
                event.reply(
                  channel,
                  MESSAGE_TYPE.WARNING,
                  `下载模型${serviceName}已取消`,
                );
              } else {
                event.reply(
                  channel,
                  MESSAGE_TYPE.ERROR,
                  `下载模型${serviceName}失败`,
                );
                // 记录错误日志而不是重新抛出异常
                console.error(`下载模型${serviceName}失败:`, e);
              }
            }
            return; // 处理完安装请求后直接返回
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
                // 记录错误日志而不是重新抛出异常
                console.error(`加载模型${serviceName}失败:`, e);
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
                // 记录错误日志而不是重新抛出异常
                console.error(`卸载模型${serviceName}失败:`, e);
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

async function installModel(serviceName: ServiceName, cancelToken?: SimpleCancellationToken) {
  try {
    const options: any = {
      shell: true,
      encoding: 'utf8',
      logger: loggerFactory(serviceName),
    };

    // 如果提供了取消令牌，则添加到选项中
    if (cancelToken) {
      options.token = cancelToken;
    }

    const result = await commandLine.exec(
      'lms',
      ['get', lmsGetNameDict[serviceName], '--yes'],
      options,
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
