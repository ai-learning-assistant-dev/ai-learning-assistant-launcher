import { dialog, IpcMain } from 'electron';
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { ActionName, channel, ServiceName, DirectoryNode } from './type-info';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getObsidianVaultConfig } from '../configs';

// 定义需要排除的目录名列表
const EXCLUDED_DIRS = new Set([
  '.obsidian',
  'copilot-conversations', 
  'copilot-custom-prompts'
]);

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
        console.log(`workspace action: ${action}, serviceName: ${serviceName}, vaultId: ${vaultId}`);
        if (action === 'save-config') {
          const workspacePath = vaultId;
          const { config } = data;
          const configPath = path.join(workspacePath, 'data.md');
          writeFileSync(configPath, JSON.stringify(config, null, 2));
          event.reply(channel, MESSAGE_TYPE.INFO, '配置保存成功');
        } else if (action === 'load-config') {
          const vaultPath = vaultId;
          const configPath = path.join(vaultPath, 'data.md');
          if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, config));
          } else {
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, null));
          }
        }else if (action === 'get-directory-structure') {
          const vaultPath = getVaultPath(vaultId);
          const tree = getDirectoryTreeWithRoot(vaultPath);
          event.reply(
            channel, 
            MESSAGE_TYPE.DATA, 
            new MessageData(action, serviceName, tree)
          );
        } else if (action === 'get-file-list') {
          const vaultPath = vaultId;
          const files = getFileList(vaultPath);
          event.reply(
            channel, 
            MESSAGE_TYPE.DATA, 
            new MessageData(action, serviceName, files)
          );
        } else if (action === 'delete-config') {
          const vaultPath = vaultId;
          const configPath = path.join(vaultPath, 'data.md');
          if (existsSync(configPath)) {
            unlinkSync(configPath); // 删除配置文件
            event.reply(channel, MESSAGE_TYPE.INFO, '配置文件删除成功');
          } else {
            event.reply(channel, MESSAGE_TYPE.ERROR, '配置文件不存在');
          }
        }
      } catch (error) {
        console.error('workspace error:', error);
        event.reply(channel, MESSAGE_TYPE.ERROR, error.message);
      }
    }
  );
}

// 新增获取路径方法
function getVaultPath(vaultId: string): string {
  const allVaultConfig = getObsidianVaultConfig();
  const vaultConfig = allVaultConfig.find(item => item.id === vaultId);
  if (!vaultConfig) {
    throw new Error(`找不到vaultId为${vaultId}的配置`);
  }
  return vaultConfig.path;
}

function getDirectoryTreeWithRoot(dirPath: string): DirectoryNode[] {
  if (!dirPath || !existsSync(dirPath)) {
    throw new Error(`无效的路径: ${dirPath}`);
  }
  
  // 获取根目录信息
  const rootDirName = path.basename(dirPath);
  const rootNode: DirectoryNode = {
    title: rootDirName,
    value: dirPath,
    key: dirPath,
    children: buildDirectoryTree(dirPath), // 使用原函数获取子目录
    isLeaf: false
  };
  
  return [rootNode];
}
// 添加目录树构建函数
function buildDirectoryTree(dirPath: string): DirectoryNode[] {
  if (!dirPath || !existsSync(dirPath)) {
    throw new Error(`无效的路径: ${dirPath}`);
  }
  
  const nodes: DirectoryNode[] = [];
  const files = readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = statSync(fullPath);

    // 跳过排除目录和文件
    if (EXCLUDED_DIRS.has(file) || !stat.isDirectory()) {
      continue;
    }
    
    nodes.push({
      title: file,
      value: fullPath,
      key: fullPath,
      children: buildDirectoryTree(fullPath),
      isLeaf: false
    });
  }
  
  return nodes;
}

// 新增获取文件列表的函数
function getFileList(dirPath: string, rootPath?: string): DirectoryNode[] {
  if (!dirPath || !existsSync(dirPath)) {
    throw new Error(`无效的路径: ${dirPath}`);
  }
  
  // 如果是首次调用，设置rootPath为dirPath
  const basePath = rootPath || dirPath;
  const nodes: DirectoryNode[] = [];
  const files = readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const relativePath = path.relative(basePath, fullPath); // 计算相对路径
    const stat = statSync(fullPath);

    // 跳过特定排除目录
    if (EXCLUDED_DIRS.has(file)) {
      continue;
    }
    
    if (stat.isDirectory()) {
      nodes.push({
        title: file,            // 保持文件名作为显示
        value: relativePath,    // 使用相对路径作为值
        key: relativePath,      // 使用相对路径作为key
        isLeaf: false,
        children: getFileList(fullPath, basePath), // 传递basePath保持一致性
      });
    } else if (stat.isFile()) {
      nodes.push({
        title: file,            // 保持文件名作为显示
        value: relativePath,    // 使用相对路径作为值
        key: relativePath,      // 使用相对路径作为key
        isLeaf: true
      });
    }
  }
  
  return nodes;
}