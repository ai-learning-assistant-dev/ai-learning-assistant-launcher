import { dialog, IpcMain } from 'electron';
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, statSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { ActionName, channel, ServiceName, DirectoryNode } from './type-info';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getObsidianVaultConfig } from '../configs';
import { gitClone } from '../git'; // 引入gitClone
import { copySync } from 'fs-extra'; // 使用fs-extra来简化目录复制

// 定义需要排除的目录名列表
const EXCLUDED_DIRS = new Set([
  '.obsidian',
  'copilot-conversations', 
  'copilot-custom-prompts',
  '.git' // 导入时也排除.git目录
]);

// 递归复制目录的辅助函数
function copyDirectory(src: string, dest: string) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName, vaultId: string, data?: any) => {
      try {
        console.log(`workspace action: ${action}, serviceName: ${serviceName}, vaultId: ${vaultId}`);
        if (action === 'save-config') {
          // ... (原有的 'save-config' 代码)
          const workspacePath = vaultId;
          const { config } = data;
          const configPath = path.join(workspacePath, 'data.md');
          writeFileSync(configPath, JSON.stringify(config, null, 2));
          event.reply(channel, MESSAGE_TYPE.INFO, '配置保存成功');
        } else if (action === 'load-config') {
          // ... (原有的 'load-config' 代码)
          const vaultPath = vaultId;
          const configPath = path.join(vaultPath, 'data.md');
          if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, config));
          } else {
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, null));
          }
        }else if (action === 'get-directory-structure') {
          // ... (原有的 'get-directory-structure' 代码)
          const vaultPath = getVaultPath(vaultId);
          const tree = getDirectoryTreeWithRoot(vaultPath);
          event.reply(
            channel, 
            MESSAGE_TYPE.DATA, 
            new MessageData(action, serviceName, tree)
          );
        } else if (action === 'get-file-list') {
          // ... (原有的 'get-file-list' 代码)
          const vaultPath = vaultId;
          const files = getFileList(vaultPath);
          event.reply(
            channel, 
            MESSAGE_TYPE.DATA, 
            new MessageData(action, serviceName, files)
          );
        } else if (action === 'delete-config') {
          // ... (原有的 'delete-config' 代码)
          const vaultPath = vaultId;
          const configPath = path.join(vaultPath, 'data.md');
          if (existsSync(configPath)) {
            unlinkSync(configPath); // 删除配置文件
            event.reply(channel, MESSAGE_TYPE.INFO, '配置文件删除成功');
          } else {
            event.reply(channel, MESSAGE_TYPE.ERROR, '配置文件不存在');
          }
        } else if (action === 'get-workspace-list') {
          // ... (原有的 'get-workspace-list' 代码)
          const vaultPath = getVaultPath(vaultId);
          const workspaces = getWorkspaceList(vaultPath);
          event.reply(
            channel, 
            MESSAGE_TYPE.DATA, 
            new MessageData(action, serviceName, workspaces)
          );
        } else if (action === 'create-workspace') {
          // ... (原有的 'create-workspace' 代码)
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
        } else if (action === 'local-import-workspace') {
          //判断当前选择的文件夹是否已经是工作区，如果已经是工作区，则导入到当前vault，如果是普通文件夹则选择已有工作区（如果当前vault下不存在工作区则提示用户进行创建）
          const vaultPath = getVaultPath(vaultId);
          const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: '选择要导入的本地工作区文件夹'
          });

          if (result.canceled || result.filePaths.length === 0) {
            event.reply(channel, MESSAGE_TYPE.INFO, '用户取消了操作');
            return;
          }

          const sourcePath = result.filePaths[0];
          const configPath = path.join(sourcePath, 'data.md');
          
          const workspaceName = path.basename(sourcePath);
          const destPath = path.join(vaultPath, workspaceName);

          if (existsSync(destPath)) {
            event.reply(channel, MESSAGE_TYPE.ERROR, `导入失败：当前仓库已存在名为 "${workspaceName}" 的工作区。`);
            return;
          }
          
          //如果是导入的工作区，把文件拷贝过来
          if (existsSync(configPath)) {
              copyDirectory(sourcePath, destPath);
              event.reply(channel, MESSAGE_TYPE.INFO, `工作区 "${workspaceName}" 导入成功！`);
              return;
            }else{
              // 如果是普通文件夹，则让用户选择一个已有的工作区进行导入
              
              // 1. 获取当前vault下所有工作区
              const existingWorkspaces = getWorkspaceList(vaultPath);

              // 2. 如果当前vault下不存在工作区，则提示用户进行创建
              if (existingWorkspaces.length === 0) {
                dialog.showMessageBoxSync({
                    type: 'warning',
                    title: '操作提示',
                    message: '当前仓库内没有可用的工作区。',
                    detail: '请先创建一个工作区，然后才能将普通文件夹导入其中。'
                });
                event.reply(channel, MESSAGE_TYPE.INFO, '操作取消：无可用工作区');
                return;
              }

              // 3. 弹窗让用户选择目标工作区
              const workspaceNames = existingWorkspaces.map(ws => ws.title);
              const buttons = [...workspaceNames, '取消'];
              const choice = await dialog.showMessageBox({
                type: 'question',
                title: '选择目标工作区',
                message: `将文件夹 "${workspaceName}" 导入到哪个工作区？`,
                buttons: buttons,
                defaultId: buttons.length - 1, // 默认选中“取消”
                cancelId: buttons.length - 1, // “取消”按钮的索引
              });

              // 如果用户点击了“取消”
              if (choice.response === buttons.length - 1) {
                event.reply(channel, MESSAGE_TYPE.INFO, '用户取消了导入操作');
                return;
              }

              // 4. 用户选择后，执行导入
              const chosenWorkspace = existingWorkspaces[choice.response];
              const targetWorkspacePath = chosenWorkspace.value; // 'value' 存储了完整路径
              const finalDestPath = path.join(targetWorkspacePath, workspaceName);

              // 再次检查，防止目标工作区内已有同名文件夹
              if (existsSync(finalDestPath)) {
                event.reply(channel, MESSAGE_TYPE.ERROR, `导入失败：工作区 "${chosenWorkspace.title}" 内已存在同名文件夹 "${workspaceName}"。`);
                return;
              }

              // 复制文件夹到目标工作区
              copyDirectory(sourcePath, finalDestPath);
              event.reply(channel, MESSAGE_TYPE.INFO, `文件夹 "${workspaceName}" 已成功导入到工作区 "${chosenWorkspace.title}"！`);
            
            }

        } else if (action === 'remote-import-get-list') {
          const { repoUrl } = data;
          const tempDir = path.join(os.tmpdir(), `aila-repo-${Date.now()}`);
          try {
            await gitClone(repoUrl, tempDir, 'main'); // 假设gitClone第三个参数是分支
            const indexPath = path.join(tempDir, 'index.json');
            if (!existsSync(indexPath)) {
              throw new Error('仓库 main 分支下未找到 index.json 文件');
            }
            const packageList = JSON.parse(readFileSync(indexPath, 'utf8'));
            event.reply(channel, MESSAGE_TYPE.DATA, new MessageData(action, serviceName, packageList));
          } finally {
            if (existsSync(tempDir)) {
              rmSync(tempDir, { recursive: true, force: true });
            }
          }
        } else if (action === 'remote-import-clone-package') {
          //修改逻辑：1.增加本地缓存机制，存储区（非临时文件，不要删除），后续需要这部分进行文件更新。
          //          1.1 存储区的选择逻辑用户不可见，存储的剩余空间最大的盘的根目录，名称：.git-storage
          // 2.下载前先选择工作区,再把存储区的文件复制到工作区,而不是直接clone到vault
            const { repoUrl, branch } = data;
            const vaultPath = getVaultPath(vaultId);
            
            // 从 release/xxx 中提取 xxx
            const workspaceName = branch.startsWith('release/') ? branch.substring('release/'.length) : path.basename(branch);

            if (!workspaceName) {
                event.reply(channel, MESSAGE_TYPE.ERROR, `无法从分支名 "${branch}" 解析工作区名称`);
                return;
            }

            const destPath = path.join(vaultPath, workspaceName);
            if (existsSync(destPath)) {
                event.reply(channel, MESSAGE_TYPE.ERROR, `导入失败：当前仓库已存在名为 "${workspaceName}" 的工作区。`);
                return;
            }

            await gitClone(repoUrl, destPath, branch);
            event.reply(channel, MESSAGE_TYPE.INFO, `远程学习包 "${workspaceName}" 导入成功！`);
        }
      } catch (error) {
        console.error(`workspace error on action ${action}:`, error);
        event.reply(channel, MESSAGE_TYPE.ERROR, error.message);
      }
    }
  );
}

// ... (其他辅助函数 getVaultPath, getDirectoryTreeWithRoot, buildDirectoryTree, getFileList, getWorkspaceList 保持不变)
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
    
    // 检查当前目录是否包含data.md文件, 或者它是一个git仓库的根目录（远程导入的标志）
    if (files.includes('data.md') || files.includes('.git')) {
      const dirName = path.basename(currentPath);
      workspaceItems.push({
        title: dirName,
        value: currentPath,
        key: currentPath,
        isLeaf: true
      });
      // 找到后不再深入此目录
      return;
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