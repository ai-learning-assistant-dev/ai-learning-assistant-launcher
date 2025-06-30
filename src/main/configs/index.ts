import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath } from '../exec';
import { dialog, IpcMain } from 'electron';
import {
  ActionName,
  channel,
  ContainerConfig,
  ObsidianConfig,
  ObsidianVaultConfig,
  ServiceName,
} from './type-info';
import { isWindows } from '../exec/util';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName, extraData?: any) => {
      console.debug(
        `configs action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      if (isWindows()) {
        if (action === 'query') {
          if (serviceName === 'obsidianApp') {
            console.debug('obsidianApp');
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, getObsidianConfig()),
            );
          } else if (serviceName === 'obsidianVault') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, getObsidianVaultConfig()),
            );
          } else if (serviceName === 'container') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, getContainerConfig()),
            );
          }
        } else if (action === 'update') {
          if (serviceName === 'obsidianApp') {
            const result = await dialog.showOpenDialog({
              properties: ['openFile', 'showHiddenFiles'],
            });
            const path = result.filePaths[0];
            if (path && path.length > 0) {
              const obsidianConfig = getObsidianConfig();
              obsidianConfig.obsidianApp.bin = path;
              setObsidianConfig(obsidianConfig);
              event.reply(channel, MESSAGE_TYPE.INFO, '成功设置Obsidian路径');
            } else {
              event.reply(channel, MESSAGE_TYPE.INFO, '没有设置好Obsidian路径');
            }
          } else if (serviceName === 'container') {
            const env = extraData?.env;
            // 修改配置
          }
        }
      }
    },
  );
}

const containerConfigPath = path.join(
  appPath,
  'external-resources',
  'ai-assistant-backend',
  'container-config.json',
);

let containerConfigBuff: ContainerConfig = {
  ASR: { port: [], command: { start: [], stop: [] } },
  TTS: { port: [], command: { start: [], stop: [] } },
  LLM: { port: [], command: { start: [], stop: [] } },
};
export function getContainerConfig() {
  const containerConfigString = readFileSync(containerConfigPath, {
    encoding: 'utf8',
  });
  const containerConfig = JSON.parse(containerConfigString) as ContainerConfig;
  if (containerConfig) {
    containerConfigBuff = containerConfig;
  }
  return containerConfig;
}

const obsidianConfigPath = path.join(
  appPath,
  'external-resources',
  'config',
  'obsidian-config.json',
);

let obsidianConfigBuff: ObsidianConfig = {
  obsidianApp: {
    bin: 'C:/a/b/c',
  },
};
export function getObsidianConfig() {
  const obsidianConfigPathString = readFileSync(obsidianConfigPath, {
    encoding: 'utf8',
  });
  const obsidianConfig = JSON.parse(obsidianConfigPathString) as ObsidianConfig;
  if (obsidianConfig) {
    obsidianConfigBuff = obsidianConfig;
  }
  return obsidianConfig;
}

export function setObsidianConfig(config) {
  writeFileSync(obsidianConfigPath, JSON.stringify(config, null, 2), {
    encoding: 'utf8',
  });
}

const obsidianVaultRawConfigExample = {
  vaults: {
    d9d365ba15702e08: {
      path: 'D:\\my-electron-app-win32-x64-1.0.0\\external-resources\\user-workspace\\my-docs',
      ts: 1750931357143,
      open: true,
    },
    '84cf481186ed4dcd': {
      path: 'D:\\my-electron-app-win32-x64-1.0.0\\external-resources\\user-workspace\\t2\\t2',
      ts: 1750931352511,
    },
  },
};

export function getObsidianVaultConfig() {
  const config: typeof obsidianVaultRawConfigExample = JSON.parse(
    readFileSync(
      '%APPDATA%\\Obsidian\\obsidian.json'.replace(
        '%APPDATA%',
        process.env.APPDATA,
      ),
      { encoding: 'utf8' },
    ),
  );
  const vaults: ObsidianVaultConfig[] = [];
  for (const key in config.vaults) {
    if (Object.prototype.hasOwnProperty.call(config.vaults, key)) {
      vaults.push({
        id: key,
        name: path.parse(config.vaults[key].path).name,
        path: config.vaults[key].path,
      });
    }
  }
  return vaults;
}

export function setVaultDefaultOpen(vaultId: string) {
  const obsidianConfigPath = '%APPDATA%\\Obsidian\\obsidian.json'.replace(
    '%APPDATA%',
    process.env.APPDATA,
  );
  const config: typeof obsidianVaultRawConfigExample = JSON.parse(
    readFileSync(obsidianConfigPath, { encoding: 'utf8' }),
  );
  for (const key in config.vaults) {
    if (Object.prototype.hasOwnProperty.call(config.vaults, key)) {
      if (key === vaultId) {
        config.vaults[key].open = true;
      } else {
        delete config.vaults[key].open;
      }
    }
  }
  writeFileSync(obsidianConfigPath, JSON.stringify(config), {
    encoding: 'utf8',
  });
  console.debug(
    'write file success',
    obsidianConfigPath,
    JSON.stringify(config),
  );
}
