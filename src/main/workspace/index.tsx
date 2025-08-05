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
        } else if (action === 'get-workspace-list') {
          const vaultPath = getVaultPath(vaultId);
          const workspaces = getWorkspaceList(vaultPath);
          event.reply(
            channel, 
            MESSAGE_TYPE.DATA, 
            new MessageData(action, serviceName, workspaces)
          );
        } else if (action === 'create-workspace') {
          try {
            // 打开文件夹选择对话框，设置默认路径为vault路径
            const vaultPath = getVaultPath(vaultId);
            // 打开文件夹选择对话框
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
              defaultPath: vaultPath
            });
            
            if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
              event.reply(channel, MESSAGE_TYPE.ERROR, '用户取消了操作');
              return;
            }
            
            const selectedPath = result.filePaths[0];
            const configPath = path.join(selectedPath, 'data.md');
            
            // 检查选择的路径是否在vault路径下或就是vault路径本身
            const relativePath = path.relative(vaultPath, selectedPath);
            // 如果relativePath为空字符串，说明selectedPath就是vaultPath
            // 如果relativePath不以..开头且不是绝对路径，说明selectedPath在vaultPath内部
            const isSubdirectory = relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));

            if (!isSubdirectory) {
              event.reply(channel, MESSAGE_TYPE.ERROR, '选择的文件夹必须在当前仓库路径下或是仓库根目录');
              return;
            }

            // 检查目录是否存在
            if (!existsSync(selectedPath)) {
              event.reply(channel, MESSAGE_TYPE.ERROR, '指定的目录不存在');
              return;
            }
            
            // 检查是否已经存在配置文件
            if (existsSync(configPath)) {
              event.reply(channel, MESSAGE_TYPE.ERROR, '该目录下已存在配置文件');
              return;
            }
            
            // 创建默认配置文件
            const defaultConfig = {
              version: '1.0',
              personas: [{
                id: 'default-persona',
                name: '默认人设',
                prompt: '这是一个示例人设'
              }],
              excludedPaths: []
            };
            
            writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            event.reply(channel, MESSAGE_TYPE.INFO, '工作区创建成功');
          } catch (error) {
            console.error('创建工作区失败:', error);
            event.reply(channel, MESSAGE_TYPE.ERROR, error.message);
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

// 添加获取工作区列表的函数
function getWorkspaceList(dirPath: string): DirectoryNode[] {
  if (!dirPath || !existsSync(dirPath)) {
    throw new Error(`无效的路径: ${dirPath}`);
  }
  
  const workspaceItems: DirectoryNode[] = [];
  
  // 递归函数，用于遍历目录树并收集所有包含data.md的工作区
  const collectWorkspaces = (currentPath: string) => {
    const files = readdirSync(currentPath);
    
    // 检查当前目录是否包含data.md文件
    if (files.includes('data.md')) {
      const dirName = path.basename(currentPath);
      workspaceItems.push({
        title: dirName,
        value: currentPath,
        key: currentPath,
        isLeaf: true
      });
    }
    
    // 遍历子目录
    for (const file of files) {
      const fullPath = path.join(currentPath, file);
      const stat = statSync(fullPath);
      
      // 跳过排除目录和文件
      if (EXCLUDED_DIRS.has(file) || !stat.isDirectory()) {
        continue;
      }
      
      collectWorkspaces(fullPath);
    }
  };
  
  collectWorkspaces(dirPath);
  return workspaceItems;
}