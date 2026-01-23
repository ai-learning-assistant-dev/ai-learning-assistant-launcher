import { IpcMain, app, dialog } from 'electron';
import { ipcHandle } from '../ipc-util';
import {
  checkLauncherUpdateHandle,
  downloadLauncherUpdateHandle,
  installLauncherUpdateHandle,
} from './type-info';
import {
  getLatestVersion,
  startWebtorrent,
  waitTorrentDone,
  destroyWebtorrentForInstall,
} from '../dlc';
import semver from 'semver';
import path from 'path';
import { appPath } from '../exec';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';

import packageJson from '../../../package.json';
const currentVersion = packageJson.version;

// 在 Electron 中使用 original-fs 处理 asar 打包后的文件操作
// original-fs 是 Electron 内置模块，API 与 Node.js fs 模块相同
// 使用类型注解确保类型安全
// eslint-disable-next-line @typescript-eslint/no-var-requires
const originalFs: typeof import('fs') = require('original-fs');

export default async function init(ipcMain: IpcMain) {
  ipcHandle(ipcMain, checkLauncherUpdateHandle, async (_event) =>
    checkLauncherUpdate(),
  );
  ipcHandle(ipcMain, downloadLauncherUpdateHandle, async (_event) =>
    downloadLauncherUpdate(),
  );
  ipcHandle(ipcMain, installLauncherUpdateHandle, async (_event) =>
    installLauncherUpdate(),
  );
}

export async function checkLauncherUpdate() {
  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const latestVersion = latestVersionInfo.version;
    const haveNew = semver.lt(currentVersion, latestVersion);

    console.debug('检查启动器更新:', {
      currentVersion,
      latestVersion,
      haveNew,
    });

    return {
      currentVersion,
      latestVersion,
      haveNew,
    };
  } catch (error) {
    console.error('检查启动器更新失败:', error);
    return {
      currentVersion,
      latestVersion: currentVersion,
      haveNew: false,
    };
  }
}

export async function downloadLauncherUpdate() {
  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );

    console.debug('开始下载启动器更新:', latestVersionInfo);

    await startWebtorrent(latestVersionInfo.dlcInfo.magnet);

    const torrent = await waitTorrentDone(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      latestVersionInfo.version,
    );

    console.debug('启动器更新下载完成');

    // 检查是否为本地开发环境
    const isDev = !app.isPackaged;
    if (isDev) {
      console.warn('当前为本地开发环境，启动器更新功能可能无法正常工作');
    }

    return {
      success: true,
      version: latestVersionInfo.version,
      filePath: path.join(torrent.path, torrent.files[0].name),
      isDev,
    };
  } catch (error) {
    console.error('下载启动器更新失败:', error);
    throw error;
  }
}

export async function installLauncherUpdate() {
  console.debug('[installLauncherUpdate] 开始执行安装更新');

  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    console.warn('[installLauncherUpdate] 开发模式下不支持自动更新');
    return {
      success: false,
      message: '开发模式下不支持自动更新，请手动解压',
    };
  }

  try {
    console.debug('[installLauncherUpdate] 获取最新版本信息...');
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const version = latestVersionInfo.version;
    console.debug('[installLauncherUpdate] 最新版本:', version);

    const downloadPath = path.join(
      appPath,
      'external-resources',
      'dlc',
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      version,
    );
    console.debug('[installLauncherUpdate] 下载路径:', downloadPath);

    // 销毁 WebTorrent 以释放文件句柄
    console.debug('[installLauncherUpdate] 销毁 WebTorrent 释放文件句柄...');
    await destroyWebtorrentForInstall(latestVersionInfo.dlcInfo.magnet);

    // ✅ 增加等待时间，确保文件句柄完全释放
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.debug('[installLauncherUpdate] 文件句柄已释放');

    const files = readdirSync(downloadPath);
    console.debug('[installLauncherUpdate] 下载目录文件列表:', files);
    const zipFile = files.find((f) => f.endsWith('.zip'));

    if (!zipFile) {
      throw new Error('未找到下载的更新包');
    }

    const zipPath = path.join(downloadPath, zipFile);
    console.debug('[installLauncherUpdate] zip文件路径:', zipPath);

    // ✅ 创建临时目录
    const tempDir = path.join(appPath, 'update-temp');
    console.debug('[installLauncherUpdate] 临时目录:', tempDir);
    if (existsSync(tempDir)) {
      console.debug('[installLauncherUpdate] 清理已存在的临时目录...');
      rmSync(tempDir, { recursive: true, force: true });
    }
    mkdirSync(tempDir, { recursive: true });

    // ✅ 先将 ZIP 文件复制到临时目录（避免 ASAR 路径问题）
    const tempZipPath = path.join(tempDir, zipFile);
    console.debug('[installLauncherUpdate] 复制 ZIP 到临时目录:', tempZipPath);

    try {
      // 使用 original-fs 读取和写入
      const zipBuffer = originalFs.readFileSync(zipPath);
      originalFs.writeFileSync(tempZipPath, zipBuffer);
      console.debug('[installLauncherUpdate] ZIP 文件复制完成');

      // 再次等待，确保文件写入完成
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (copyError) {
      console.error('[installLauncherUpdate] 复制 ZIP 文件失败:', copyError);
      throw new Error('复制安装包失败: ' + (copyError as Error).message);
    }

    // ✅ 现在使用临时目录中的 ZIP 文件进行解压
    console.log('[installLauncherUpdate] 正在解压文件...');
    console.log('[installLauncherUpdate] ZIP路径:', tempZipPath);

    const extractDir = path.join(tempDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });

    try {
      const zip = new AdmZip(tempZipPath);
      const zipEntries = zip.getEntries();
      console.log(
        '[installLauncherUpdate] ZIP包含的文件数量:',
        zipEntries.length,
      );

      // 手动解压每个文件
      for (const entry of zipEntries) {
        const entryPath = path.join(extractDir, entry.entryName);

        if (entry.isDirectory) {
          if (!originalFs.existsSync(entryPath)) {
            originalFs.mkdirSync(entryPath, { recursive: true });
          }
        } else {
          const parentDir = path.dirname(entryPath);
          if (!originalFs.existsSync(parentDir)) {
            originalFs.mkdirSync(parentDir, { recursive: true });
          }

          const content = entry.getData();
          originalFs.writeFileSync(entryPath, content);
        }
      }
      console.log('[installLauncherUpdate] 解压完成');
    } catch (extractError) {
      console.error('[installLauncherUpdate] 解压失败:', extractError);
      throw extractError;
    }

    // 查找解压后的 exe 文件
    const findExe = (dir: string): string | null => {
      const items = originalFs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = originalFs.statSync(fullPath);
        if (stat.isDirectory()) {
          const result = findExe(fullPath);
          if (result) return result;
        } else if (
          item.endsWith('.exe') &&
          item.includes('AI-Learning-Assistant-Launcher')
        ) {
          return fullPath;
        }
      }
      return null;
    };

    const newExePath = findExe(extractDir);

    if (!newExePath) {
      throw new Error('未在更新包中找到启动器可执行文件');
    }

    console.debug('找到新版本可执行文件:', newExePath);

    const currentExePath = app.getPath('exe');
    const currentExeDir = path.dirname(currentExePath);
    const currentExeName = path.basename(currentExePath);
    const backupPath = path.join(currentExeDir, `${currentExeName}.old`);

    // ✅ 修改更新脚本，添加更多错误处理和日志
    const updateScriptPath = path.join(appPath, 'update.bat');
    const updateScript = `@echo off
chcp 65001
echo ====================================
echo AI学习助手启动器更新程序
echo ====================================
echo.

echo [1/5] 等待主程序退出...
timeout /t 3 /nobreak >nul

echo [2/5] 删除旧备份文件...
if exist "${backupPath}" (
    del /f /q "${backupPath}"
    if errorlevel 1 (
        echo 警告: 删除旧备份失败
    ) else (
        echo 旧备份已删除
    )
)

echo [3/5] 备份当前版本...
if exist "${currentExePath}" (
    move /y "${currentExePath}" "${backupPath}"
    if errorlevel 1 (
        echo 错误: 备份失败，更新中止
        pause
        exit /b 1
    )
    echo 备份完成
) else (
    echo 警告: 未找到当前程序
)

echo [4/5] 安装新版本...
copy /y "${newExePath}" "${currentExePath}"
if errorlevel 1 (
    echo 错误: 安装失败，尝试恢复...
    if exist "${backupPath}" (
        move /y "${backupPath}" "${currentExePath}"
        echo 已恢复到旧版本
    )
    pause
    exit /b 1
)
echo 安装完成

echo [5/5] 清理临时文件...
timeout /t 1 /nobreak >nul
rmdir /s /q "${tempDir}"
echo 清理完成

echo.
echo ====================================
echo 更新成功！正在启动新版本...
echo ====================================
timeout /t 2 /nobreak >nul

start "" "${currentExePath}"

(goto) 2>nul & del "%~f0"
`;

    originalFs.writeFileSync(updateScriptPath, updateScript, {
      encoding: 'utf8',
    });

    console.debug('更新脚本已创建:', updateScriptPath);

    const result = await dialog.showMessageBox({
      type: 'info',
      title: '准备更新',
      message: '启动器将在关闭后自动更新',
      detail: `当前版本: ${currentVersion}\n新版本: ${version}\n\n点击"确定"后程序将关闭并自动更新，更新完成后会自动重启。`,
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      // ✅ 使用 detached 模式启动批处理文件
      const child = spawn(
        'cmd.exe',
        ['/c', 'start', '/min', updateScriptPath],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: false, // 显示窗口以便用户看到进度
          shell: true,
        },
      );

      child.unref();

      // 延迟退出，确保批处理脚本已启动
      setTimeout(() => {
        app.quit();
      }, 1500);

      return {
        success: true,
        message: '正在更新启动器...',
      };
    } else {
      // 用户取消，清理临时文件
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      return {
        success: false,
        message: '用户取消更新',
      };
    }
  } catch (error) {
    console.error('[installLauncherUpdate] 安装启动器更新失败:', error);
    console.error(
      '[installLauncherUpdate] 错误堆栈:',
      error instanceof Error ? error.stack : '无堆栈信息',
    );
    throw error;
  }
}
