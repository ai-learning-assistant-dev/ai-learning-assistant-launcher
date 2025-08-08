import {
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { IpcMain } from 'electron';
import {
  ActionName,
  channel,
  ObsidianPlugin,
  PluginManifest,
  ServiceName,
} from './type-info';
import { isWindows } from '../exec/util';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getObsidianVaultConfig } from '../configs';
import { gitClone } from '../git';
import { appPath } from '../exec';
import cpy from 'cpy';

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
          await updateTemplate();
          await copyPluginToVault(serviceName, vaultId);
          event.reply(channel, MESSAGE_TYPE.INFO, '成功安装插件');
        } else if (action === 'update') {
          await updateTemplate();
          await copyPluginToVault(serviceName, vaultId);
          event.reply(channel, MESSAGE_TYPE.INFO, '成功更新插件');
        }
      }
    },
  );
}

function getVaultConfig(vaultId: string) {
  const allVaultConfig = getObsidianVaultConfig();
  const vaultConfig = allVaultConfig.filter((item) => item.id === vaultId)[0];
  return vaultConfig;
}

function getPlugins(vaultId: string) {
  const vaultConfig = getVaultConfig(vaultId);

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
    isLatest: true,
    isInstalled: true,
    manageByLauncher: false,
    path: pathString,
  };
}

function appendPluginInfoNotInstalled(obsidianPlugins: ObsidianPlugin[]) {
  const installedPluginIds = obsidianPlugins.map((p) => p.id);
  const templatePlugins = getTemplatePlugins();
  obsidianPlugins.map((p) => {
    const indexInTemplate = templatePlugins.findIndex((v) => v.id === p.id);
    if (indexInTemplate >= 0) {
      p.latestVersion = templatePlugins[indexInTemplate].version;
      p.manageByLauncher = true;
      if (p.version !== p.latestVersion) {
        p.isLatest = false;
      } else {
        p.isLatest = true;
      }
    }

    return p;
  });
  const notInstalledPluginsInfo = templatePlugins
    .filter((p) => installedPluginIds.indexOf(p.id) < 0)
    .map<ObsidianPlugin>((item) => {
      return {
        id: item.id,
        name: item.name,
        version: item.version,
        latestVersion: item.version,
        isInstalled: false,
        isLatest: false,
        manageByLauncher: true,
        path: '',
      };
    });
  return notInstalledPluginsInfo.concat(obsidianPlugins).sort((a, b) => {
    if (a.id > b.id) {
      return 1;
    } else if (a.id < b.id) {
      return -1;
    } else {
      return 0;
    }
  });
}

export async function updateTemplate() {
  const obsidianPluginsTemplate = path.join(
    appPath,
    'external-resources',
    'obsidian-plugins-template',
  );
  const tmpDir = path.join(obsidianPluginsTemplate, 'tmp');

  try {
    rmSync(tmpDir, { recursive: true });
  } catch (e) {
    console.warn(e);
  }
  mkdirSync(tmpDir, { recursive: true });

  const pluginGitDir = path.join(tmpDir, 'ai-learning-assistant-plugin-dist');
  await gitClone(
    'https://gitee.com/ai-learning-assistant-dev/ai-learning-assistant-plugin-dist.git',
    pluginGitDir,
  );

  console.debug(
    'clone success',
    'https://gitee.com/ai-learning-assistant-dev/ai-learning-assistant-plugin-dist.git',
  );

  const pluginPath = path.join(obsidianPluginsTemplate, '.obsidian', 'plugins');

  try {
    rmSync(pluginPath, { recursive: true });
  } catch (e) {
    console.warn(e);
  }

  await cpy(
    path.join(pluginGitDir, 'ai-learning-assistant-dev', '**'),
    pluginPath,
  );

  rmSync(tmpDir, { recursive: true });
}

function getTemplatePlugins() {
  const pluginPath = path.join(
    appPath,
    'external-resources',
    'obsidian-plugins-template',
    '.obsidian',
    'plugins',
  );
  const pluginPaths = getSubdirectories(pluginPath);
  const plugins = pluginPaths.map<ObsidianPlugin>(getObsidianPluginInfo);
  return plugins;
}

async function copyPluginToVault(pluginId: string, vaultId: string) {
  console.debug('start copy plugin', pluginId, vaultId);
  const vaultConfig = getVaultConfig(vaultId);
  const plugin = appendPluginInfoNotInstalled(getPlugins(vaultId)).filter(
    (item) => item.id === pluginId,
  )[0];
  const templatePlugin = getTemplatePlugins().filter(
    (item) => item.id === pluginId,
  )[0];
  if (plugin && templatePlugin) {
    let dirName = path.parse(templatePlugin.path).base;
    if (plugin.isInstalled) {
      dirName = path.parse(plugin.path).base;
      // rmSync(plugin.path, { recursive: true });
    }
    console.debug(
      'cpy',
      path.join(templatePlugin.path, '**'),
      path.join(vaultConfig.path, '.obsidian', 'plugins', dirName),
    );
    await cpy(
      path.join(templatePlugin.path, '**'),
      path.join(vaultConfig.path, '.obsidian', 'plugins', dirName),
    );
    console.debug('copy plugin success', pluginId, vaultId);
  }
}
