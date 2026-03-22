import { IpcMain } from 'electron';
import { ipcHandle } from '../ipc-util';
import {
  queryNativeTrainingConfigHandle,
  setNativeTrainingConfigHandle,
  TrainingConfig,
} from './type-info';

export async function initTrainingConfig(ipcMain: IpcMain) {
  ipcHandle(ipcMain, queryNativeTrainingConfigHandle, async (_event) =>
    queryTrainingConfig(),
  );
  ipcHandle(
    ipcMain,
    setNativeTrainingConfigHandle,
    async (_event, config: TrainingConfig) => setTrainingConfig(config),
  );
}

export async function queryTrainingConfig(): Promise<TrainingConfig> {
  // TODO 读取external-resources\config\training-config.json
  return {
    env: {
      UNLOCK_ALL_SECTION: false,
    },
  };
}

export async function setTrainingConfig(
  config: TrainingConfig,
): Promise<TrainingConfig> {
  // TODO 将config写入external-resources\config\training-config.json
  return {
    env: {
      UNLOCK_ALL_SECTION: true,
    },
  };
}
