import { dialog, IpcMain } from 'electron';
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, statSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { ActionName, channel, ServiceName, DirectoryNode } from './type-info';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import { getObsidianVaultConfig } from '../configs';
import { gitClone } from '../git'; // 引入gitClone
import { copySync } from 'fs-extra'; // 使用fs-extra来简化目录复制
import git from 'isomorphic-git';
import fs from 'fs';
import http from 'isomorphic-git/http/node';
import { appPath ,Exec} from '../exec';
const commandLine = new Exec();

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

/**
 * Finds the drive with the most free space ONCE, caches the result, and returns the path.
 * On subsequent runs, it reads the path from the cache file.
 * @returns {string} The absolute path to the .git-storage directory.
 */
function getGitStoragePath(): string {
  // Define the path for the configuration file.

  // const configDir = path.join(appPath, 'external-resources', 'user-workspace');
  // const configFilePath = path.join(configDir, 'git-storage.json');
  // const storageDirName = '.git-storage';

  // // 1. Try to read the path from the cached config file first.
  // if (existsSync(configFilePath)) {
  //   try {
  //     const config = JSON.parse(readFileSync(configFilePath, 'utf8'));
  //     // Verify that the cached path actually exists on the filesystem.
  //     if (config.storagePath && existsSync(config.storagePath)) {
  //       console.log(`Using cached storage path: ${config.storagePath}`);
  //       return config.storagePath;
  //     } else {
  //       console.warn('Configured storage path not found or invalid. Recalculating...');
  //     }
  //   } catch (error) {
  //     console.error('Error reading git-storage.json. Recalculating...', error);
  //     // Proceed to recalculate if the file is corrupt.
  //   }
  // }

  // // 2. If cache doesn't exist or is invalid, calculate the best path.
  // console.log('No valid cached path found. Determining best drive for storage...');
  const storagePath = path.join(
    appPath,
    'external-resources',
    'obsidian-plugins-template',
    '.git-storage'
  );

  return storagePath;
}

/**
 * Creates a safe directory name from a git URL.
 * @param {string} repoUrl - The URL of the repository.
 * @returns {string} A filesystem-safe name.
 */
function getRepoDirNameFromUrl(repoUrl: string): string {
    return new URL(repoUrl).pathname.slice(1).replace('.git', '').replace(/\//g, '_');
}

/**
 * 查找给定学习包名称在本地存储区中的仓库路径（storagePath/<vendor>/<packageName>）
 */
function findStorageRepoPathByPackage(packageName: string): string | null {
  const storagePath = getGitStoragePath();
  if (!existsSync(storagePath)) {
    return null;
  }
  const vendorDirs = readdirSync(storagePath, { withFileTypes: true });
  for (const vendor of vendorDirs) {
    if (!vendor.isDirectory()) continue;
    const candidate = path.join(storagePath, vendor.name, packageName);
    if (existsSync(candidate) && existsSync(path.join(candidate, '.git'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * 清空一个目录（但保留 .git 目录）
 */
function clearWorkingDirectoryExceptGit(dir: string) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const target = path.join(dir, entry.name);
    rmSync(target, { recursive: true, force: true });
  }
}

// 辅助函数：在已克隆的仓库目录中，通过 fetch + checkout 判断指定分支是否包含 data.md
async function checkPackageHasDataMdInRepo(clonedRepoDir: string, branch: string): Promise<boolean> {
  try {
    // 拉取指定分支的最新内容（浅拉取，加速）
    await git.fetch({ fs, http, dir: clonedRepoDir, remote: 'origin', ref: branch, singleBranch: true, depth: 1 });
    // 切换到远程分支工作树
    await git.checkout({ fs, dir: clonedRepoDir, ref: `origin/${branch}`, force: true });

    const filelistPath = path.join(clonedRepoDir, 'filelist.json');
    if (!existsSync(filelistPath)) {
      return false;
    }
    const filesToCheck: string[] = JSON.parse(readFileSync(filelistPath, 'utf8'));
    return filesToCheck.includes('data.md');
  } catch (error) {
    console.error(`检查学习包 ${branch} 是否包含data.md时出错:`, error);
    return false;
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
              excludedPaths: [],
              description: ''
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
            // 先克隆默认分支（浅克隆）到临时目录
            await gitClone(repoUrl, tempDir);
            const indexPath = path.join(tempDir, 'index.json');
            if (!existsSync(indexPath)) {
              throw new Error('仓库默认分支下未找到 index.json 文件');
            }
            const packageList = JSON.parse(readFileSync(indexPath, 'utf8'));

            // 在同一临时仓库中逐分支 fetch + checkout 进行判断，避免多次 clone
            const packageListWithDataMdCheck = await Promise.all(
              packageList.map(async (pkg: any) => {
                const hasDataMd = await checkPackageHasDataMdInRepo(tempDir, pkg.branch);
                return {
                  ...pkg,
                  hasDataMd,
                };
              }),
            );

            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, packageListWithDataMdCheck),
            );
          } finally {
            if (existsSync(tempDir)) {
              rmSync(tempDir, { recursive: true, force: true });
            }
          }
        } else if (action === 'remote-import-clone-package') {
        // 1. Get parameters from frontend, now including targetWorkspacePath and hasDataMd
        const { repoUrl, branch, targetWorkspacePath, hasDataMd } = data;

        const newFolderName = branch.startsWith('release/') ? branch.substring('release/'.length) : path.basename(branch);
        const vaultPath = getVaultPath(vaultId)
        // 2. Determine storage and repository paths
        const storagePath = getGitStoragePath();
        const repoDirName = getRepoDirNameFromUrl(repoUrl);
        const base_repoStoragePath = path.join(storagePath, repoDirName);

        const repoStoragePath = path.join(base_repoStoragePath, newFolderName)
        
        // 3. Clone or Fetch the repository in the storage area
        if (existsSync(repoStoragePath)) {
            console.log(`Repository exists at ${repoStoragePath}. Fetching updates...`);
            await git.fetch({ fs, http, dir: repoStoragePath, ref: branch, singleBranch: true, depth: 1 });
            await git.checkout({ fs, dir: repoStoragePath, ref: `origin/${branch}`, force: true });
        } else {
            console.log(`Cloning repository to ${repoStoragePath}...`);
            await gitClone(repoUrl, repoStoragePath, branch);
        }
        
        // 4.1 Read filelist.json from the storage area
        const filelistPath = path.join(repoStoragePath, 'filelist.json');
        if (!existsSync(filelistPath)) {
            throw new Error(`学习包 "(${branch})" 的存储库中缺少 filelist.json 文件。`);
        }
        const filesToCopy: string[] = JSON.parse(readFileSync(filelistPath, 'utf8'));

        // 4.2 Read filelist.json from the storage area
        const descPath = path.join(repoStoragePath, 'desc.json');
        if (!existsSync(descPath)) {
            throw new Error(`学习包 "(${branch})" 的存储库中缺少 desc.json 文件。`);
        }
        let workspaceName :string = JSON.parse(readFileSync(descPath, 'utf8'))[0].name;

        // 5. Determine the final destination based on whether the package contains data.md
        let finalDestPath: string;
        let successMessage: string;
        let workspacePath :string;

        if (hasDataMd) {
            // 如果包含data.md，作为独立工作区导入到targetWorkspacePath
            if (!vaultPath) {
              throw new Error('未设置当前工作区路径,是一个bug，应该默认是当前vaultPath');
          }
            workspacePath= path.join(vaultPath, workspaceName);
            console.log(workspaceName)

            finalDestPath = path.join(workspacePath, newFolderName);
            console.log(finalDestPath)
            successMessage = `学习包 "${newFolderName}" 已成功导入为独立工作区！`;
        } else {
            // 如果不包含data.md，导入到指定的工作区内
            if (!targetWorkspacePath) {
                throw new Error('该学习包不包含data.md文件，需要指定目标工作区');
            }
            finalDestPath = path.join(targetWorkspacePath, newFolderName);
            successMessage = `学习包 "${newFolderName}" 已成功导入到工作区 "${path.basename(targetWorkspacePath)}"！`;
        }
        
        if (existsSync(finalDestPath)) {
            let failedMessage = `导入失败：目标位置已存在名为 "${newFolderName}" 的文件夹, 请切换仓库或者选择更新`
            event.reply(channel, MESSAGE_TYPE.ERROR, failedMessage);
            throw new Error(`导入失败：目标位置已存在名为 "${newFolderName}" 的文件夹。`);
        }
        mkdirSync(finalDestPath, { recursive: true });

        // 6. Copy files from storage to the destination according to filelist.json
        for (const file of filesToCopy) {
            
            const sourceFile = path.join(repoStoragePath, file);
            const destFile = path.join(finalDestPath, file);
            
            if (existsSync(sourceFile)) {
                // Ensure the destination directory for the file exists
                mkdirSync(path.dirname(destFile), { recursive: true });
                if (file === 'data.md') {
                  const destDataMdPath = path.join(workspacePath, 'data.md');
                  copySync(sourceFile, destDataMdPath, { overwrite: true });
                  continue
                }
                copySync(sourceFile, destFile);
            } else {
                console.warn(`Warning: File "${file}" listed in filelist.json not found in the repository.`);
            }
        }

        event.reply(channel, MESSAGE_TYPE.INFO, successMessage);
    }
        else if (action === 'update-workspace') {
                    // 'forceUpdate' is a new parameter to handle the conflict resolution option
                    const { targetWorkspacePath, forceUpdate = false } = data as { targetWorkspacePath: string, forceUpdate?: boolean };

                    if (!targetWorkspacePath || !existsSync(targetWorkspacePath)) {
                      event.reply(channel, MESSAGE_TYPE.ERROR, '无效或不存在的目标工作区路径');
                      return;
                    }
          
                    // 1. 检索选中的工作区中有哪些学习资料包（第一层文件夹名）
                    const entries = readdirSync(targetWorkspacePath, { withFileTypes: true });
                    const packageDirs = entries
                      .filter(e => e.isDirectory() && !EXCLUDED_DIRS.has(e.name))
                      .map(e => e.name);
          
                    if (packageDirs.length === 0) {
                      event.reply(channel, MESSAGE_TYPE.INFO, '该工作区内未发现可更新的学习资料包。');
                      return;
                    }
          
                    const updateResults: { pkgName: string, message: string, conflict: boolean }[] = [];
          
                    for (const pkgName of packageDirs) {
                      const currentPackageWorkspacePath = path.join(targetWorkspacePath, pkgName);
                      const repoStoragePath = findStorageRepoPathByPackage(pkgName);
          
                      if (!repoStoragePath) {
                        updateResults.push({ pkgName, message: '未在本地存储区找到对应缓存，已跳过。', conflict: false });
                        continue;
                      }
          
                      const releaseBranch = `release/${pkgName}`;
                      const userBranch = `user/${pkgName}`;
                      const remoteReleaseBranch = `origin/${releaseBranch}`;
                      let isWorkSpace: boolean = false
                      
                      // 区分是资料还是工作区，否则行为会不同，工作区要考虑data.md的影响
                      const filelistPath = path.join(repoStoragePath, "filelist.json");
                      const filesToCheck: string[] = JSON.parse(readFileSync(filelistPath, 'utf8'));
                      if (filesToCheck.includes('data.md')){
                        isWorkSpace = true
                      }

                      try {
                        // a. 定位仓库并获取最新信息
                        await commandLine.exec('git', ['fetch', 'origin'], { cwd: repoStoragePath});
          
                        // 检查远端分支是否存在，不存在则跳过
                        try {
                          commandLine.exec('git', ['show-ref', '--verify', '--quiet', `refs/remotes/${remoteReleaseBranch}`], { cwd: repoStoragePath});
                        } catch (e) {
                          updateResults.push({ pkgName, message: `远端仓库缺少 ${releaseBranch} 分支，已跳过。`, conflict: false });
                          continue;
                        }
          
                        // 如果是强制更新，则走“放弃修改，强制更新”逻辑
                        if (forceUpdate) {
                          // 确保 user/xxx 分支存在并检出
                          await commandLine.exec('git', ['checkout', '-B', userBranch, releaseBranch], { cwd: repoStoragePath });
                          // 强制重置为远端最新版
                          await commandLine.exec('git', ['reset', '--hard', remoteReleaseBranch], { cwd: repoStoragePath});
                          
                          // 清空工作区并从存储区复制回最新内容
                          clearWorkingDirectoryExceptGit(currentPackageWorkspacePath);
                          copySync(repoStoragePath, currentPackageWorkspacePath, { filter: (src) => !path.basename(src).startsWith('.git')});
          
                          updateResults.push({ pkgName, message: '已强制更新到最新版本，您的本地修改已被覆盖。', conflict: false });
                          continue; // 处理下一个包
                        }
          
                      // b. 准备 user 分支
                      let userBranchExists = false;
                      try {
                        await commandLine.exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${userBranch}`], { cwd: repoStoragePath });
                        userBranchExists = true;
                      } catch (e) { /* Branch does not exist */ }

                      if (userBranchExists) {
                        await commandLine.exec('git', ['checkout', userBranch], { cwd: repoStoragePath });
                      } else {
                        await commandLine.exec('git', ['checkout', '-B', userBranch, releaseBranch], { cwd: repoStoragePath });
                      }

                      // c. 【核心修改】同步用户工作区的修改
                      // 我们将工作区内容“叠加”到存储库工作目录，而不是先清空。
                      // 这可以保留存储库中的 filelist.json 等文件，避免 "modify/delete" 冲突。
                      
                      copySync(currentPackageWorkspacePath, repoStoragePath, {
                        overwrite: true,
                        filter: (src) => !src.includes('.git') // 确保不触碰.git目录
                      });
                      if (isWorkSpace){
                        //追加data.md
                        const sourceDataMdPath = path.join(targetWorkspacePath,"data.md")
                        const destDataMdPath = path.join(repoStoragePath,"data.md")
                        copySync(sourceDataMdPath,destDataMdPath)
                      }
                      
                      await commandLine.exec('git', ['add', '.'], { cwd: repoStoragePath });
                      try {
                        await commandLine.exec('git', ['commit', '-m', 'Sync user workspace changes before update'], { cwd: repoStoragePath });
                      } catch (commitError) {
                        if (!commitError.stdout?.toString().includes('nothing to commit')) {
                          throw commitError;
                        }
                        console.log(commitError)
                        

                      }finally{
                        // 如果没有变化，直接检查远端是否有更新
                        const { stdout: localSha } = await commandLine.exec('git', ['rev-parse', 'HEAD'], { cwd: repoStoragePath });
                        const { stdout: remoteSha } = await commandLine.exec('git', ['rev-parse', remoteReleaseBranch], { cwd: repoStoragePath });
                        const { stdout: mergeBase } = await commandLine.exec('git', ['merge-base', 'HEAD', remoteReleaseBranch], { cwd: repoStoragePath });

                        console.log("localSha: ",localSha.trim());
                        console.log("remoteSha: ",remoteSha.trim());
                        console.log("mergeBase: ",mergeBase.trim());

                        // 如果本地已经是远端或者远程落后于本地，则无需更新
                          if (localSha.trim() === remoteSha.trim() || mergeBase.trim() === remoteSha.trim()) {
                            updateResults.push({ pkgName, message: '已是最新版本。', conflict: false });
                            //event.reply(channel, MESSAGE_TYPE.INFO, `${pkgName}已是最新版本。`);
                            continue; // 跳到下一个包
                        }

                      }
          
                        // d. 执行三路合并
                        try {
                          // 在 user/xxx 分支上，尝试合并远程最新的 release/xxx 分支
                          await commandLine.exec('git', ['merge', remoteReleaseBranch, '-m', `Merge remote-tracking branch '${remoteReleaseBranch}'`], { cwd: repoStoragePath });
                          
                          console.log(`远程与本地合并成功`);
                          // 如果可以成功合并 (无冲突)

                          const filelistPath = path.join(repoStoragePath, 'filelist.json');
                          if (!existsSync(filelistPath)) {
                              throw new Error(`错误：合并后的学习包 "(${pkgName})" 缺少 filelist.json 文件。`);
                          }

                          const filesToSync: string[] = JSON.parse(readFileSync(filelistPath, 'utf8'));
                          
                          for (const fileRelativePath of filesToSync) {
                            const sourceFile = path.join(repoStoragePath, fileRelativePath);
                            const destFile = path.join(currentPackageWorkspacePath, fileRelativePath);
                            
                            if (existsSync(sourceFile)) {
                                // 确保目标文件的父目录存在
                                mkdirSync(path.dirname(destFile), { recursive: true });
                                // 特殊处理data.md
                                if ( fileRelativePath === "data.md" ){
                                  const destDataMdPath = path.join(targetWorkspacePath, 'data.md');
                                  copySync(sourceFile, destDataMdPath, { overwrite: true });
                                  console.log("data.md已被正确的复制到：",destDataMdPath)
                                  continue
                                }
                                copySync(sourceFile, destFile, { overwrite: true });
                            } else {
                                // 这种情况理论上不应发生，但作为警告是好的
                                console.warn(`警告: 文件 "${fileRelativePath}" 在 filelist.json 中列出，但在存储库中未找到。`);
                            }
                        }
                          updateResults.push({ pkgName, message: '更新成功！您的修改已与最新版自动合并。', conflict: false });
                          //event.reply(channel, MESSAGE_TYPE.INFO, `${pkgName}更新成功！您的修改已与最新版自动合并。`);
                        } catch (mergeError) {
                          // 如果不能合并 (发生冲突)
                          // 必须立即中止合并
                          await commandLine.exec('git', ['merge', '--abort'], { cwd: repoStoragePath });

                          const stderr = mergeError.stderr?.toString() || 'No stderr output';
                          const stdout = mergeError.stdout?.toString() || 'No stdout output';
                          const rawError = `GIT MERGE FAILED:\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`;
                          console.error(`--- Raw Merge Error for ${pkgName} ---\n`, rawError);
                          
                          // 向用户清晰地展示冲突信息
                          const message = `更新失败，存在合并冲突！\n建议：将最新版下载为新的学习包以便手动迁移。\n或选项：放弃您的修改，强制更新。`;
                          updateResults.push({ pkgName, message, conflict: true });
                        }
                      } catch (error) {
                        updateResults.push({ pkgName, message: `处理时发生未知错误: ${error.message}`, conflict: false });
                        console.error(`Error processing package ${pkgName}:`, error);
                      } finally {
                        // e. 收尾：将存储区仓库的活动分支切回 release/xxx
                        try {
                          if (existsSync(repoStoragePath)) {
                            await commandLine.exec('git', ['checkout', releaseBranch], { cwd: repoStoragePath });
                          }
                        } catch (e) {
                          console.error(`[${pkgName}]: 收尾操作失败，无法切回 ${releaseBranch} 分支。`);
                        }
                      }
                    }
          
                    // 汇总所有结果后，统一发送给前端
                    // 前端可以根据 'conflict: true' 字段来决定是否显示特殊UI（如强制更新按钮）
                    event.reply(channel, MESSAGE_TYPE.INFO, updateResults.map(item => item.message).join('\n'));
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