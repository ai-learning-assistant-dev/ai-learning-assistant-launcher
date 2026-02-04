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
import { existsSync, mkdirSync, rmSync } from 'fs';
import {
  readdir,
  writeFile,
  appendFile,
  access,
  rename,
  stat,
  unlink,
  constants,
} from 'fs/promises';
import { spawn } from 'child_process';

import packageJson from '../../../package.json';
const currentVersion = packageJson.version;

// 更新日志文件路径
const updateLogPath = path.join(appPath, 'launcher-update.log');
const updateLogBackupPath = path.join(appPath, 'launcher-update.log.old');

// 日志滚动配置
const LOG_ROTATION_CONFIG = {
  MAX_SIZE_BYTES: 1 * 1024 * 1024, // 1MB
};

/**
 * 写入更新日志到文件
 * @param level 日志级别
 * @param message 日志消息
 * @param data 附加数据
 */
async function writeUpdateLog(
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  data?: unknown,
) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${level}] ${message}`;
  if (data !== undefined) {
    try {
      logLine += ` ${JSON.stringify(data)}`;
    } catch {
      logLine += ` [无法序列化的数据]`;
    }
  }
  logLine += '\n';

  try {
    await appendFile(updateLogPath, logLine, { encoding: 'utf8' });
  } catch (err) {
    console.error('写入更新日志失败:', err);
  }

  // 同时输出到控制台
  switch (level) {
    case 'DEBUG':
      console.debug(message, data ?? '');
      break;
    case 'INFO':
      console.log(message, data ?? '');
      break;
    case 'WARN':
      console.warn(message, data ?? '');
      break;
    case 'ERROR':
      console.error(message, data ?? '');
      break;
  }
}

/**
 * 初始化日志文件（检查大小并执行滚动）
 * 当日志文件超过 MAX_SIZE_BYTES 时，将旧日志重命名为 .old 文件
 */
async function initUpdateLog() {
  try {
    // 检查日志文件是否存在及其大小
    if (existsSync(updateLogPath)) {
      const stats = await stat(updateLogPath);

      if (stats.size >= LOG_ROTATION_CONFIG.MAX_SIZE_BYTES) {
        // 删除旧的备份文件（如果存在）
        try {
          await unlink(updateLogBackupPath);
        } catch {
          // 备份文件不存在，忽略
        }

        // 将当前日志重命名为备份
        await rename(updateLogPath, updateLogBackupPath);

        console.log(
          `[initUpdateLog] 日志文件已滚动，旧日志大小: ${(stats.size / 1024).toFixed(2)} KB`,
        );
      }
    }
  } catch (err) {
    console.error('[initUpdateLog] 日志滚动检查失败:', err);
  }

  // 添加分隔符
  const separator = `
${'='.repeat(60)}
[${new Date().toISOString()}] 启动器更新日志开始
${'='.repeat(60)}
`;
  try {
    await appendFile(updateLogPath, separator, { encoding: 'utf8' });
  } catch {
    // 忽略错误
  }
}

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

/**
 * 清理更新临时目录
 * 当已是最新版本时调用，清理之前更新留下的临时文件
 */
async function cleanupUpdateTempDir() {
  const tempDir = path.join(app.getPath('temp'), 'launcher-update');

  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
      await writeUpdateLog(
        'INFO',
        '[cleanupUpdateTempDir] 已清理更新临时目录',
        { tempDir },
      );
    }
  } catch (err) {
    await writeUpdateLog(
      'WARN',
      '[cleanupUpdateTempDir] 清理更新临时目录失败',
      err instanceof Error ? { message: err.message } : err,
    );
  }
}

export async function checkLauncherUpdate() {
  await initUpdateLog();
  await writeUpdateLog('INFO', '[checkLauncherUpdate] 开始检查启动器更新');

  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const latestVersion = latestVersionInfo.version;

    // 版本号规范校验
    if (!semver.valid(currentVersion)) {
      await writeUpdateLog(
        'ERROR',
        '[checkLauncherUpdate] 当前版本号格式无效',
        { currentVersion },
      );
      throw new Error(`当前版本号格式无效: ${currentVersion}`);
    }

    if (!semver.valid(latestVersion)) {
      await writeUpdateLog(
        'ERROR',
        '[checkLauncherUpdate] 最新版本号格式无效',
        { latestVersion },
      );
      throw new Error(`最新版本号格式无效: ${latestVersion}`);
    }

    const haveNew = semver.lt(currentVersion, latestVersion);

    await writeUpdateLog('INFO', '[checkLauncherUpdate] 检查启动器更新完成', {
      currentVersion,
      latestVersion,
      haveNew,
    });

    // 如果已是最新版本，清理更新临时目录
    if (!haveNew) {
      await cleanupUpdateTempDir();
    }

    return {
      currentVersion,
      latestVersion,
      haveNew,
    };
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[checkLauncherUpdate] 检查启动器更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    return {
      currentVersion,
      latestVersion: currentVersion,
      haveNew: false,
    };
  }
}

export async function downloadLauncherUpdate() {
  await writeUpdateLog('INFO', '[downloadLauncherUpdate] 开始下载启动器更新');

  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );

    // 空值检查：确保 dlcInfo 和 magnet 存在
    if (!latestVersionInfo.dlcInfo?.magnet) {
      throw new Error('未找到有效的更新包信息（dlcInfo 或 magnet 缺失）');
    }

    const { magnet } = latestVersionInfo.dlcInfo;

    await writeUpdateLog(
      'DEBUG',
      '[downloadLauncherUpdate] 获取到最新版本信息',
      {
        version: latestVersionInfo.version,
        magnet: magnet.substring(0, 50) + '...',
      },
    );

    await startWebtorrent(magnet);
    await writeUpdateLog('DEBUG', '[downloadLauncherUpdate] WebTorrent 已启动');

    const torrent = await waitTorrentDone(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      latestVersionInfo.version,
    );

    const filePath = path.join(torrent.path, torrent.files[0].name);
    await writeUpdateLog(
      'INFO',
      '[downloadLauncherUpdate] 启动器更新下载完成',
      {
        path: torrent.path,
        fileName: torrent.files[0].name,
      },
    );

    // 检查是否为本地开发环境，请打包后测试
    const isDev = !app.isPackaged;
    if (isDev) {
      await writeUpdateLog(
        'WARN',
        '[downloadLauncherUpdate] 当前为本地开发环境，启动器更新功能可能无法正常工作',
      );
    }

    return {
      success: true,
      version: latestVersionInfo.version,
      filePath,
      isDev,
    };
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[downloadLauncherUpdate] 下载启动器更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}

/**
 * 生成自定义更新批处理脚本
 * 脚本功能：等待应用退出、解压更新包、校验完整性、备份旧版本、替换文件、恢复数据、启动新版本
 *
 * 安全策略：采用"解压 -> 校验 -> 备份 -> 替换"模式
 * 1. 先在临时目录完整解压并校验
 * 2. 校验失败则直接启动旧版本，不做任何修改
 * 3. 校验成功后备份整个旧版本目录
 * 4. 替换失败时可从备份恢复
 */
async function generateUpdateScript(
  zipPath: string,
  appDir: string,
  tempDir: string,
  newVersion: string,
): Promise<string> {
  const scriptContent = `@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "ZIP_PATH=${zipPath.replace(/\//g, '\\')}"
set "APP_DIR=${appDir.replace(/\//g, '\\')}"
set "TEMP_DIR=${tempDir.replace(/\//g, '\\')}"
set "BACKUP_DIR=${tempDir.replace(/\//g, '\\')}\\external-resources-backup"
set "APP_BACKUP_DIR=${tempDir.replace(/\//g, '\\')}\\app-backup"
set "EXTRACT_DIR=${tempDir.replace(/\//g, '\\')}\\extracted"
set "UPDATE_LOG=${tempDir.replace(/\//g, '\\')}\\update-script.log"

:: 日志函数
call :log "========== 更新脚本开始 =========="

call :log "等待应用退出..."
:waitloop
tasklist /FI "IMAGENAME eq AI Learning Assistant Launcher.exe" 2>NUL | find /I "AI Learning Assistant Launcher.exe" >NUL
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)

call :log "应用已退出，开始更新..."

:: ========== 阶段1: 准备和解压 ==========
call :log "[阶段1] 准备临时目录..."
if exist "%TEMP_DIR%" rd /s /q "%TEMP_DIR%" 2>nul
mkdir "%TEMP_DIR%"
mkdir "%EXTRACT_DIR%"

call :log "[阶段1] 解压更新包到临时目录..."
powershell -Command "try { Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%EXTRACT_DIR%' -Force -ErrorAction Stop; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    call :log "[错误] 解压失败！启动旧版本..."
    goto :launch_old_version
)

:: 查找解压后的目录（ZIP 内可能有一层目录）
set "SOURCE_DIR="
for /d %%D in ("%EXTRACT_DIR%\\*") do set "SOURCE_DIR=%%D"
if not defined SOURCE_DIR set "SOURCE_DIR=%EXTRACT_DIR%"

call :log "[阶段1] 解压完成，源目录: %SOURCE_DIR%"

:: ========== 阶段2: 校验解压完整性 ==========
call :log "[阶段2] 校验更新包完整性..."

:: 检查关键文件是否存在
if not exist "%SOURCE_DIR%\\AI Learning Assistant Launcher.exe" (
    call :log "[错误] 校验失败：主程序文件不存在！启动旧版本..."
    goto :launch_old_version
)

if not exist "%SOURCE_DIR%\\resources" (
    call :log "[错误] 校验失败：resources 目录不存在！启动旧版本..."
    goto :launch_old_version
)

call :log "[阶段2] 校验通过，更新包完整"

:: ========== 阶段3: 备份用户数据和旧版本 ==========
call :log "[阶段3] 备份用户数据 external-resources..."
if exist "%APP_DIR%\\external-resources" (
    xcopy "%APP_DIR%\\external-resources" "%BACKUP_DIR%\\" /E /I /H /Y /Q >nul 2>&1
    if errorlevel 1 (
        call :log "[警告] 用户数据备份可能不完整"
    ) else (
        call :log "[阶段3] 用户数据备份完成"
    )
)

call :log "[阶段3] 备份旧版本应用..."
mkdir "%APP_BACKUP_DIR%" 2>nul
xcopy "%APP_DIR%\\*" "%APP_BACKUP_DIR%\\" /E /I /H /Y /Q >nul 2>&1
if errorlevel 1 (
    call :log "[警告] 旧版本备份可能不完整，但继续更新"
) else (
    call :log "[阶段3] 旧版本备份完成"
)

:: ========== 阶段4: 替换文件 ==========
call :log "[阶段4] 清理旧版本文件（保留 external-resources）..."
for /d %%D in ("%APP_DIR%\\*") do (
    if /I not "%%~nxD"=="external-resources" (
        rd /s /q "%%D" 2>nul
    )
)
for %%F in ("%APP_DIR%\\*") do (
    del /f /q "%%F" 2>nul
)

call :log "[阶段4] 安装新版本..."
xcopy "%SOURCE_DIR%\\*" "%APP_DIR%\\" /E /I /H /Y /Q >nul 2>&1
if errorlevel 1 (
    call :log "[错误] 复制新文件失败！尝试从备份恢复..."
    goto :restore_from_backup
)

:: 验证安装结果
if not exist "%APP_DIR%\\AI Learning Assistant Launcher.exe" (
    call :log "[错误] 安装验证失败：主程序不存在！尝试从备份恢复..."
    goto :restore_from_backup
)

call :log "[阶段4] 新版本安装完成"

:: ========== 阶段5: 恢复用户数据 ==========
call :log "[阶段5] 恢复用户数据..."
if exist "%BACKUP_DIR%" (
    xcopy "%BACKUP_DIR%\\*" "%APP_DIR%\\external-resources\\" /E /I /H /Y /Q >nul 2>&1
    call :log "[阶段5] 用户数据恢复完成"
)

:: ========== 阶段6: 清理和启动 ==========
call :log "[阶段6] 更新成功！清理临时文件..."
:: 延迟删除临时目录，避免影响日志
start /b cmd /c "timeout /t 5 /nobreak >nul & rd /s /q "%TEMP_DIR%" 2>nul"

call :log "[阶段6] 启动新版本..."
call :log "========== 更新脚本结束 =========="
start "" "%APP_DIR%\\AI Learning Assistant Launcher.exe"
exit

:: ========== 错误处理: 从备份恢复 ==========
:restore_from_backup
call :log "[恢复] 开始从备份恢复旧版本..."
if exist "%APP_BACKUP_DIR%\\AI Learning Assistant Launcher.exe" (
    :: 清理可能的残留
    for /d %%D in ("%APP_DIR%\\*") do rd /s /q "%%D" 2>nul
    for %%F in ("%APP_DIR%\\*") do del /f /q "%%F" 2>nul
    
    :: 恢复备份
    xcopy "%APP_BACKUP_DIR%\\*" "%APP_DIR%\\" /E /I /H /Y /Q >nul 2>&1
    if exist "%APP_DIR%\\AI Learning Assistant Launcher.exe" (
        call :log "[恢复] 旧版本恢复成功"
        goto :launch_old_version
    )
)
call :log "[恢复] 恢复失败，请手动重新安装应用"
pause
exit

:: ========== 错误处理: 启动旧版本 ==========
:launch_old_version
call :log "[回退] 启动旧版本..."
if exist "%APP_DIR%\\AI Learning Assistant Launcher.exe" (
    start "" "%APP_DIR%\\AI Learning Assistant Launcher.exe"
) else (
    call :log "[错误] 旧版本也不存在，请手动重新安装"
    pause
)
exit

:: ========== 日志函数 ==========
:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1 >> "%UPDATE_LOG%" 2>nul
exit /b 0
`;

  // 确保临时目录存在
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const scriptPath = path.join(tempDir, 'update.bat');
  await writeFile(scriptPath, scriptContent, { encoding: 'utf8' });

  await writeUpdateLog('INFO', '[generateUpdateScript] 更新脚本已生成', {
    scriptPath,
    zipPath,
    appDir,
    tempDir,
    newVersion,
  });

  return scriptPath;
}

/**
 * 等待文件句柄释放的重试配置
 */
const FILE_RELEASE_CONFIG = {
  MAX_RETRIES: 10,
  INITIAL_DELAY_MS: 200,
  MAX_DELAY_MS: 2000,
};

/**
 * 检测文件是否可访问（句柄已释放）
 * 通过尝试 rename 操作来验证文件是否被占用
 * @param filePath 文件路径
 * @returns 是否可访问
 */
async function isFileAccessible(filePath: string): Promise<boolean> {
  try {
    // 检查文件是否可读
    await access(filePath, constants.R_OK);

    // 尝试 rename 到自身（Windows 下被占用的文件无法 rename）
    // 这是检测文件句柄是否释放的可靠方法
    const tempPath = filePath + '.tmp_check';
    await rename(filePath, tempPath);
    await rename(tempPath, filePath);

    return true;
  } catch {
    return false;
  }
}

/**
 * 等待文件句柄释放，使用指数退避重试机制
 * @param filePath 文件路径
 * @returns 文件是否可访问
 */
async function waitForFileRelease(filePath: string): Promise<void> {
  let delay = FILE_RELEASE_CONFIG.INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= FILE_RELEASE_CONFIG.MAX_RETRIES; attempt++) {
    const accessible = await isFileAccessible(filePath);

    if (accessible) {
      await writeUpdateLog('DEBUG', '[waitForFileRelease] 文件句柄已释放', {
        filePath,
        attempt,
      });
      return;
    }

    await writeUpdateLog(
      'DEBUG',
      '[waitForFileRelease] 文件仍被占用，等待重试',
      {
        filePath,
        attempt,
        nextDelayMs: delay,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    // 指数退避，但不超过最大延迟
    delay = Math.min(delay * 2, FILE_RELEASE_CONFIG.MAX_DELAY_MS);
  }

  throw new Error(
    `文件句柄释放超时: ${filePath}，已重试 ${FILE_RELEASE_CONFIG.MAX_RETRIES} 次`,
  );
}

export async function installLauncherUpdate() {
  await writeUpdateLog('INFO', '[installLauncherUpdate] 开始执行自定义更新');

  // 如果是开发模式，不执行更新
  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    await writeUpdateLog(
      'WARN',
      '[installLauncherUpdate] 开发模式下不支持自动更新',
    );
    return {
      success: false,
      message: '开发模式下不支持自动更新',
    };
  }

  try {
    // 获取最新版本信息
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 获取最新版本信息...',
    );
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );

    // 空值检查：确保 dlcInfo 和 magnet 存在
    if (!latestVersionInfo.dlcInfo?.magnet) {
      throw new Error('未找到有效的更新包信息（dlcInfo 或 magnet 缺失）');
    }

    const { magnet } = latestVersionInfo.dlcInfo;
    const version = latestVersionInfo.version;
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 最新版本:', version);

    // 下载目录
    const downloadPath = path.join(
      appPath,
      'external-resources',
      'dlc',
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      version,
    );
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 下载路径:',
      downloadPath,
    );

    if (!existsSync(downloadPath)) {
      await writeUpdateLog('ERROR', '[installLauncherUpdate] 下载目录不存在');
      throw new Error('更新包未下载，请先下载更新包');
    }

    // 查找 ZIP 文件
    const files = await readdir(downloadPath);
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 下载目录文件列表:',
      files,
    );

    const zipFile = files.find((f) => f.endsWith('.zip'));
    if (!zipFile) {
      await writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 未找到 .zip 更新包',
      );
      throw new Error('未找到 .zip 更新包');
    }

    const zipPath = path.join(downloadPath, zipFile);
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] ZIP 文件路径:',
      zipPath,
    );

    // 销毁 WebTorrent 以释放文件句柄
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 销毁 WebTorrent 释放文件句柄...',
    );
    await destroyWebtorrentForInstall(magnet);

    // 使用重试机制等待文件句柄释放
    await waitForFileRelease(zipPath);
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 文件句柄已释放');

    // 获取应用目录和临时目录
    const exePath = app.getPath('exe');
    const appDir = path.dirname(exePath);
    const tempDir = path.join(app.getPath('temp'), 'launcher-update');

    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 应用目录:', appDir);
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 临时目录:', tempDir);

    // 显示更新确认对话框
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '准备更新',
      message: '启动器将在关闭后自动更新',
      detail: `当前版本: ${currentVersion}\n新版本: ${version}\n\n点击"确定"后程序将关闭并自动更新，更新完成后会自动重启。`,
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response !== 0) {
      await writeUpdateLog('INFO', '[installLauncherUpdate] 用户取消更新');
      return {
        success: false,
        message: '用户取消更新',
      };
    }

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 用户确认更新，准备执行自定义更新',
    );

    // 生成更新脚本
    const scriptPath = await generateUpdateScript(
      zipPath,
      appDir,
      tempDir,
      version,
    );

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 启动更新脚本:',
      scriptPath,
    );

    // 启动更新脚本
    const updateProcess = spawn('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    updateProcess.unref();

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 更新脚本已启动，准备退出应用',
    );

    // 延迟退出应用
    setTimeout(() => {
      app.quit();
    }, 1000);

    return {
      success: true,
      message: '正在更新启动器...',
    };
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[installLauncherUpdate] 自定义更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}
