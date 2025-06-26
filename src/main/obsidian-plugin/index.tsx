import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { IpcMain } from 'electron';
import {
  ActionName,
  channel,
  ObsidianPlugin,
  pluginList,
  PluginManifest,
  ServiceName,
} from './type-info';
import { isWindows } from '../exec/util';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getObsidianVaultConfig } from '../configs';

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (
      event,
      action: ActionName,
      serviceName: ServiceName,
      vaultId: string,
    ) => {
      console.debug(
        `obsidian-config action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      if (isWindows()) {
        if (action === 'query') {
          if (serviceName === 'all') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(
                action,
                serviceName,
                appendPluginInfoNotInstalled(getPlugins(vaultId)),
              ),
            );
          }
        } else if (action === 'install') {
        } else if (action === 'update') {
        }
      }
    },
  );
}

function getPlugins(vaultId: string) {
  const allVaultConfig = getObsidianVaultConfig();
  const vaultConfig = allVaultConfig.filter((item) => item.id === vaultId)[0];

  const pluginPaths = getSubdirectories(
    path.join(vaultConfig.path, '.obsidian', 'plugins'),
  );
  const plugins = pluginPaths.map<ObsidianPlugin>(getObsidianPluginInfo);
  return plugins;
}

/**
 * 获取目录下所有子目录
 * @param {string} dirPath 目录路径
 * @returns {string[]} 子目录路径数组
 */
function getSubdirectories(dirPath: string) {
  try {
    const files = readdirSync(dirPath); // 同步读取目录内容
    const subdirectories: string[] = [];
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = statSync(filePath); // 获取文件/目录状态
      if (stat.isDirectory()) {
        // 检查是否为目录
        subdirectories.push(filePath);
      }
    }
    return subdirectories;
  } catch (error) {
    console.error(`Error reading directory ${dirPath}: ${error.message}`);
    return []; // 返回空数组，避免程序崩溃
  }
}

function getObsidianPluginInfo(pathString: string): ObsidianPlugin {
  const manifest: PluginManifest = JSON.parse(
    readFileSync(path.join(pathString, 'manifest.json'), { encoding: 'utf8' }),
  );
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    latestVersion: manifest.version,
    isLatest: false,
    isInstalled: true,
  };
}

function appendPluginInfoNotInstalled(obsidianPlugins: ObsidianPlugin[]) {
  const installedPluginIds = obsidianPlugins.map((p) => p.id);
  const notInstalledPluginIds = pluginList.filter(
    (item) => installedPluginIds.indexOf(item) < 0,
  );
  const notInstalledPluginsInfo = notInstalledPluginIds.map<ObsidianPlugin>(
    (item) => {
      return {
        id: item,
        name: item,
        version: '',
        latestVersion: '',
        isInstalled: false,
        isLatest: false,
      };
    },
  );
  return notInstalledPluginsInfo.concat(obsidianPlugins);
}
