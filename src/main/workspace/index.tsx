import { dialog, IpcMain } from 'electron';
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { ActionName, channel, ServiceName, DirectoryNode } from './type-info';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';

export interface WorkspaceConfig {
  version?: string;
  personas?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  excludedPaths?: string[];
}

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName, vaultId: string, data?: any) => {
      try {
        console.debug(`workspace action: ${action}, serviceName: ${serviceName}, vaultId: ${vaultId}`);
        
        if (action === 'select-path') {
          const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
          });
          if (!result.canceled && result.filePaths.length > 0) {
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, result.filePaths[0]));
          }
        } else if (action === 'save-config') {
          const { path: workspacePath, config } = data;
          const configPath = path.join(workspacePath, 'data.md');
          writeFileSync(configPath, JSON.stringify(config, null, 2));
          event.reply(channel, MESSAGE_TYPE.INFO, '配置保存成功');
        } else if (action === 'load-config') {
          const configPath = path.join(data.path, 'data.md');
          if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, config));
          } else {
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, null));
          }
        }else if (action === 'get-directory-structure') {
          const dirPath = data;
          const tree = buildDirectoryTree(dirPath);
          event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, tree));
        }
      } catch (error) {
        console.error('workspace error:', error);
        event.reply(channel, MESSAGE_TYPE.ERROR, error.message);
      }
    }
  );
}

// 添加目录树构建函数
function buildDirectoryTree(dirPath: string, basePath?: string): DirectoryNode[] {
  if (!existsSync(dirPath)) return [];
  
  const nodes: DirectoryNode[] = [];
  const files = readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = statSync(fullPath);
    const relativePath = basePath ? path.relative(basePath, fullPath) : fullPath;
    
    if (stat.isDirectory()) {
      nodes.push({
        title: file,
        value: relativePath,
        key: relativePath,
        children: buildDirectoryTree(fullPath, basePath || dirPath),
        isLeaf: false
      });
    } else {
      nodes.push({
        title: file,
        value: relativePath,
        key: relativePath,
        isLeaf: true
      });
    }
  }
  
  return nodes;
}