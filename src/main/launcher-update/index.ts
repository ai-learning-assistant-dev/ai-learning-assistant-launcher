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
  rmSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'fs';

import {
  readdir,
  writeFile,
  appendFile,
  stat,
  unlink,
  rename,
  access,
  constants,
} from 'fs/promises';
import { spawn, execFile } from 'child_process';

import packageJson from '../../../package.json';
import { setForceQuit } from '../joint-build';
const currentVersion = packageJson.version;

// ========== 两阶段更新配置 ==========
/**
 * 更新配置接口
 * 用于在两阶段更新中传递更新状态
 */
interface UpdateConfig {
  pendingUpdate: boolean;
  updatePath: string;
  version: string;
  timestamp: number;
}

// 更新配置文件路径（存储在用户数据目录）
const UPDATE_CONFIG_PATH = path.join(
  app.getPath('userData'),
  'update-config.json',
);
// 待更新的 ZIP 包路径
const PENDING_UPDATE_PATH = path.join(
  app.getPath('userData'),
  'pending-update.zip',
);

/**
 * 获取更新临时目录的完整路径
 * 使用 realpathSync 将 Windows 8.3 短路径转换为完整路径
 * 例如：C:\Users\ADMINI~1 -> C:\Users\Administrator
 *
 * 关键改进：
 * 1. 创建目录后再进行 realpathSync（因为 realpathSync 要求路径存在）
 * 2. 转换失败时抛出异常，而不是静默回落到短路径
 * 3. 确保返回的路径始终为完整长路径
 */
function getUpdateTempDir(): string {
  const baseTempDir = app.getPath('temp');

  // 添加备用方案
  const fallbackDir = path.join(app.getPath('userData'), 'update-temp');

  try {
    if (!existsSync(baseTempDir)) {
      mkdirSync(baseTempDir, { recursive: true });
    }

    const fullBaseTempDir = realpathSync(baseTempDir);
    const tempDir = path.join(fullBaseTempDir, 'launcher-update');

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    return realpathSync(tempDir);
  } catch (err) {
    // 使用备用目录
    console.warn('[getUpdateTempDir] 使用备用目录', fallbackDir);
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true });
    }
    return fallbackDir;
  }
}

// 更新日志文件路径
const updateLogPath = path.join(appPath, 'launcher-update.log');
const updateLogBackupPath = path.join(appPath, 'launcher-update.log.old');

// PowerShell 脚本日志文件路径（与主日志放在同一目录，便于查看）
const scriptLogPath = path.join(appPath, 'launcher-update-script.log');
const scriptLogBackupPath = path.join(
  appPath,
  'launcher-update-script.log.old',
);

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
 * 对单个日志文件执行滚动
 * @param logPath 日志文件路径
 * @param backupPath 备份文件路径
 */
async function rotateLogFile(logPath: string, backupPath: string) {
  try {
    if (existsSync(logPath)) {
      const stats = await stat(logPath);

      if (stats.size >= LOG_ROTATION_CONFIG.MAX_SIZE_BYTES) {
        // 删除旧的备份文件（如果存在）
        try {
          await unlink(backupPath);
        } catch {
          // 备份文件不存在，忽略
        }

        // 将当前日志重命名为备份
        await rename(logPath, backupPath);

        console.log(
          `[rotateLogFile] 日志文件已滚动: ${logPath}，旧日志大小: ${(stats.size / 1024).toFixed(2)} KB`,
        );
      }
    }
  } catch (err) {
    console.error(`[rotateLogFile] 日志滚动检查失败 (${logPath}):`, err);
  }
}

/**
 * 初始化日志文件（检查大小并执行滚动）
 * 当日志文件超过 MAX_SIZE_BYTES 时，将旧日志重命名为 .old 文件
 */
async function initUpdateLog() {
  // 滚动主日志文件
  await rotateLogFile(updateLogPath, updateLogBackupPath);

  // 滚动脚本日志文件
  await rotateLogFile(scriptLogPath, scriptLogBackupPath);

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

/**
 * 检查并清理残留的更新配置
 * 在应用启动时调用，清理可能由于更新失败而残留的配置文件
 *
 * 注意：实际的文件替换操作由 PowerShell 脚本在主进程退出后执行
 * 此函数仅用于清理残留配置，不会执行文件替换
 *
 * @returns 始终返回 false（不会触发重启）
 */
export async function checkAndApplyPendingUpdate(): Promise<boolean> {
  // 初始化日志
  await initUpdateLog();

  await writeUpdateLog(
    'INFO',
    '[checkAndApplyPendingUpdate] 检查残留的更新配置...',
  );

  // 检查配置文件是否存在
  if (!existsSync(UPDATE_CONFIG_PATH)) {
    await writeUpdateLog(
      'DEBUG',
      '[checkAndApplyPendingUpdate] 没有残留的更新配置',
    );
    return false;
  }

  // 如果配置文件存在，说明之前的更新可能失败了，清理它
  try {
    const configContent = readFileSync(UPDATE_CONFIG_PATH, 'utf-8');
    const config: UpdateConfig = JSON.parse(configContent);

    await writeUpdateLog(
      'WARN',
      '[checkAndApplyPendingUpdate] 发现残留的更新配置，可能是之前更新失败',
      {
        version: config.version,
        timestamp: config.timestamp,
      },
    );

    // 清理配置文件
    try {
      unlinkSync(UPDATE_CONFIG_PATH);
      await writeUpdateLog(
        'INFO',
        '[checkAndApplyPendingUpdate] 已清理残留配置文件',
      );
    } catch (err) {
      await writeUpdateLog(
        'WARN',
        '[checkAndApplyPendingUpdate] 清理配置文件失败',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }

    // 清理残留的更新包
    if (existsSync(config.updatePath)) {
      try {
        unlinkSync(config.updatePath);
        await writeUpdateLog(
          'INFO',
          '[checkAndApplyPendingUpdate] 已清理残留更新包',
        );
      } catch (err) {
        await writeUpdateLog(
          'WARN',
          '[checkAndApplyPendingUpdate] 清理更新包失败',
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[checkAndApplyPendingUpdate] 清理残留配置时出错',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  // 始终返回 false，让应用正常启动
  return false;
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
  const tempDir = getUpdateTempDir();

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

// 防止重复调用的标志
let isInstallInProgress = false;

/**
 * 生成 PowerShell 更新脚本
 * 脚本功能：等待主进程退出 -> 解压更新包 -> 保留用户数据 -> 启动新版本
 */
async function generatePowerShellUpdateScript(
  zipPath: string,
  appDir: string,
  version: string,
  exePath: string,
): Promise<string> {
  const tempDir = path.join(app.getPath('userData'), 'update-temp');
  const scriptPath = path.join(tempDir, `update-${Date.now()}.ps1`);
  // 脚本日志文件放在 appPath 下，与主日志文件同目录，便于查看和管理
  // 使用固定文件名，避免日志分散
  const logPath = scriptLogPath;

  // 确保临时目录存在
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  // 获取当前进程 ID 和可执行文件路径
  const currentPid = process.pid;
  const exeName = 'AI-Learning-Assistant-Launcher.exe';
  const parentExePath = exePath.replace(/\\/g, '\\\\'); // 转义路径分隔符用于 PowerShell

  const scriptContent = `
# PowerShell Update Script - UTF-8 Encoding
# Using "Polling Rename + Temporary File Replacement" to ensure file handles are fully released
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$LogFile = "${logPath.replace(/\\/g, '\\\\')}"
$ZipPath = "${zipPath.replace(/\\/g, '\\\\')}"
$AppDir = "${appDir.replace(/\\/g, '\\\\')}"
$ExeName = "${exeName}"
$Version = "${version}"
$ParentPid = ${currentPid}
$ParentExePath = "${parentExePath}"
$MaxWaitSeconds = 60
$MaxRenameRetries = 120  # Max rename retries (500ms each, up to 60 seconds)

# 需要保留的日志文件模式（不会在更新时被删除）
$PreserveLogPatterns = @(
    "launcher-update.log",
    "launcher-update.log.old",
    "launcher-update-script.log",
    "launcher-update-script.log.old",
    "launcher.log",
    "launcher.log.old",
    "launcher.old.log"
)

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Write-Host $logMessage
    Add-Content -Path $LogFile -Value $logMessage -Encoding UTF8
}

# Initialize log file with separator (for distinguishing different update sessions)
function Initialize-Log {
    $separator = [char]10 + ("=" * 60) + [char]10 + "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] PowerShell Update Script Session Started" + [char]10 + ("=" * 60)
    Add-Content -Path $LogFile -Value $separator -Encoding UTF8
}

# Polling rename function - Core method
# If file can be renamed, it means we have control of the file (handle released)
function Wait-FileUnlocked {
    param(
        [string]$FilePath,
        [int]$MaxRetries = $MaxRenameRetries
    )
    
    if (-not (Test-Path $FilePath)) {
        return $true
    }
    
    $oldPath = "$FilePath.old"
    $retryCount = 0
    
    while ($retryCount -lt $MaxRetries) {
        try {
            # Try to rename file - This is an atomic operation
            # If successful, it means file handle is fully released
            Rename-Item -Path $FilePath -NewName "$($([System.IO.Path]::GetFileName($FilePath))).old" -Force -ErrorAction Stop
            Write-Log "[Rename] Successfully renamed: $FilePath -> .old (Attempt $($retryCount + 1))"
            return $true
        } catch {
            $retryCount++
            if ($retryCount % 20 -eq 0) {
                Write-Log "[Rename] Waiting for file unlock: $FilePath (Tried $retryCount times)"
            }
            Start-Sleep -Milliseconds 500
        }
    }
    
    Write-Log "[ERROR] File rename timeout: $FilePath"
    return $false
}

# Clean up .old files
function Remove-OldFiles {
    param([string]$Directory)
    
    Get-ChildItem -Path $Directory -Filter "*.old" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Remove-Item -Path $_.FullName -Force -ErrorAction Stop
            Write-Log "[Cleanup] Deleted: $($_.FullName)"
        } catch {
            Write-Log "[WARN] Failed to delete .old file: $($_.FullName)"
        }
    }
}

try {
    # Initialize log file with session separator
    Initialize-Log
    
    # ===== Self-Healing Phase: Ensure script has fully detached from parent process control =====
    Write-Log "========== Launcher Update Script Started =========="
    Write-Log "Log file location: $LogFile"
    Write-Log "Script has entered execution phase (self-healing check)"
    Write-Log "Target Version: $Version"
    Write-Log "ZIP Path: $ZipPath"
    Write-Log "App Directory: $AppDir"
    Write-Log "Parent PID: $ParentPid"
    Write-Log "Update Strategy: Polling Rename + Temporary File Replacement"
    Write-Log "Preserved log files: $($PreserveLogPatterns -join ', ')"
    
    # Initial wait: Ensure Electron main process completes exit sequence
    Write-Log "Initial delay: waiting for Electron to complete exit sequence..."
    Start-Sleep -Seconds 2
    
    # ===== Self-Healing Code: Force terminate parent if still alive =====
    # This is a fail-safe mechanism to handle cases where main process failed to exit properly
    Write-Log "Self-healing check: verifying parent process status..."
    try {
        $parentProc = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
        if ($null -ne $parentProc) {
            Write-Log "[Self-Healing] Parent process still alive, attempting force termination PID: $ParentPid"
            Write-Log "[Self-Healing] Process Name: $($parentProc.ProcessName), StartTime: $($parentProc.StartTime)"
            
            # Try graceful close first
            try {
                $parentProc.CloseMainWindow() | Out-Null
                Start-Sleep -Seconds 2
            } catch {
                Write-Log "[Self-Healing] CloseMainWindow failed, will force kill"
            }
            
            # Check if already exited
            $parentProc = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
            if ($null -ne $parentProc) {
                Write-Log "[Self-Healing] Force terminating parent process..."
                Stop-Process -Id $ParentPid -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 1
            }
            
            Write-Log "[Self-Healing] Parent process termination completed"
        } else {
            Write-Log "[Self-Healing] Parent process already exited, good"
        }
    } catch {
        Write-Log "[Self-Healing] Exception during parent check (likely already exited): $($_.Exception.Message)"
    }

    # ===== Capture parent process identity to prevent PID reuse false positive =====
    $ExpectedProcessName = "AI-Learning-Assistant-Launcher"
    $ParentStartTime = $null
    $ParentPath = $ParentExePath
    try {
        $initialParent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
        if ($null -ne $initialParent) {
            $ParentStartTime = $initialParent.StartTime
            # Also capture actual path from process as fallback
            if ($null -eq $ParentPath -or $ParentPath -eq "") {
                try {
                    $ParentPath = $initialParent.Path
                } catch {
                    Write-Log "[WARN] Could not get process path: $($_.Exception.Message)"
                }
            }
            Write-Log "Captured parent process identity - Name: $($initialParent.ProcessName), StartTime: $ParentStartTime, Path: $ParentPath"
        }
    } catch {
        Write-Log "[WARN] Could not capture parent process identity: $($_.Exception.Message)"
    }
    
    # ===== Formally wait for parent process to exit (with PID reuse protection) =====
    Write-Log "Waiting for main process to fully exit..."
    $waitCount = 0
    $confirmedExit = $false
    while ($waitCount -lt $MaxWaitSeconds) {
        try {
            $proc = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
            if ($null -eq $proc) {
                # PID not found - process likely exited
                Write-Log "Main process confirmed exited (PID not found)"
                $confirmedExit = $true
                break
            }
                
            # PID reuse protection: verify process identity matches expected parent
            # If any identity attribute differs, it's a different process (PID reused)
            $isSameProcess = $true
            
            # 1. Check start time
            if ($null -ne $ParentStartTime) {
                try {
                    $currentStartTime = $proc.StartTime
                    if ($currentStartTime -ne $ParentStartTime) {
                        $isSameProcess = $false
                        Write-Log "[PID Reuse Detected] Start time mismatch - Expected: $ParentStartTime, Current: $currentStartTime"
                    }
                } catch {
                    Write-Log "[WARN] Could not compare start times: $($_.Exception.Message)"
                }
            }
            
            # 2. Check process name
            if ($proc.ProcessName -notlike "*$ExpectedProcessName*") {
                $isSameProcess = $false
                Write-Log "[PID Reuse Detected] Process name mismatch - Expected: $ExpectedProcessName, Current: $($proc.ProcessName)"
            }
            
            # 3. Check executable path (most reliable identifier)
            if ($null -ne $ParentPath -and $ParentPath -ne "") {
                try {
                    $currentPath = $proc.Path
                    # Use case-insensitive comparison for Windows paths
                    if ($currentPath -and $currentPath.ToLower() -ne $ParentPath.ToLower()) {
                        $isSameProcess = $false
                        Write-Log "[PID Reuse Detected] Executable path mismatch - Expected: $ParentPath, Current: $currentPath"
                    }
                } catch {
                    Write-Log "[WARN] Could not compare executable paths: $($_.Exception.Message)"
                }
            }
                
            if (-not $isSameProcess) {
                Write-Log "[PID Reuse] PID $ParentPid now belongs to a different process, original process has exited"
                $confirmedExit = $true
                break
            }
                
            # If still alive after 10 seconds, try force kill again
            if ($waitCount -eq 10) {
                Write-Log "[Fallback] Process still alive after 10s, force killing..."
                Stop-Process -Id $ParentPid -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Write-Log "Main process exited (exception detected)"
            $confirmedExit = $true
            break
        }
        Start-Sleep -Seconds 1
        $waitCount++
        if ($waitCount % 10 -eq 0) {
            Write-Log "Still waiting for main process to exit... ($waitCount seconds)"
        }
    }
    
    if (-not $confirmedExit -and $waitCount -ge $MaxWaitSeconds) {
        Write-Log "[WARN] Timeout waiting for main process to exit, but proceeding with caution..."
        # Add extra safety delay when timeout occurred
        Write-Log "Adding extra 3-second safety delay due to timeout..."
        Start-Sleep -Seconds 3
    }

    # ===== Polling rename critical files =====
    # Confirm file handles are fully released by attempting rename
    Write-Log "Starting to poll for file handle release..."
    
    $exePath = Join-Path $AppDir $ExeName
    $criticalFiles = @(
        $exePath,
        (Join-Path $AppDir "libEGL.dll"),
        (Join-Path $AppDir "libGLESv2.dll"),
        (Join-Path $AppDir "ffmpeg.dll")
    )
    
    # Check app.asar (if exists)
    $asarPath = Join-Path $AppDir "resources\\app.asar"
    if (Test-Path $asarPath) {
        $criticalFiles += $asarPath
    }
    
    $allUnlocked = $true
    foreach ($file in $criticalFiles) {
        if (Test-Path $file) {
            Write-Log "Checking file: $file"
            $unlocked = Wait-FileUnlocked -FilePath $file
            if (-not $unlocked) {
                $allUnlocked = $false
                Write-Log "[ERROR] File still locked: $file"
            }
        }
    }
    
    if (-not $allUnlocked) {
        Write-Log "[ERROR] Some files cannot be unlocked, update aborted"
        # Try to restore renamed files
        Get-ChildItem -Path $AppDir -Filter "*.old" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            $originalName = $_.FullName -replace '\\.old$', ''
            try {
                Rename-Item -Path $_.FullName -NewName ([System.IO.Path]::GetFileName($originalName)) -Force
            } catch {}
        }
        exit 1
    }
    
    Write-Log "All critical file handles released"

    # Verify ZIP file exists
    if (-not (Test-Path $ZipPath)) {
        Write-Log "[ERROR] ZIP file does not exist: $ZipPath"
        exit 1
    }

    # Backup external-resources
    $externalResources = Join-Path $AppDir "external-resources"
    $backupDir = Join-Path $env:TEMP "launcher-external-resources-backup"
    
    if (Test-Path $externalResources) {
        Write-Log "Backing up user data..."
        if (Test-Path $backupDir) {
            Remove-Item -Path $backupDir -Recurse -Force
        }
        Copy-Item -Path $externalResources -Destination $backupDir -Recurse -Force
        Write-Log "User data backup completed"
    }

    # Extract to temporary directory
    $extractDir = Join-Path $env:TEMP "launcher-update-extract"
    if (Test-Path $extractDir) {
        Remove-Item -Path $extractDir -Recurse -Force
    }
    
    Write-Log "Extracting update package..."
    Expand-Archive -Path $ZipPath -DestinationPath $extractDir -Force
    Write-Log "Extraction completed"

    # Find directory containing exe
    $sourceDir = $extractDir
    $exeFile = Get-ChildItem -Path $extractDir -Filter $ExeName -Recurse -File | Select-Object -First 1
    if ($null -ne $exeFile) {
        $sourceDir = $exeFile.DirectoryName
        Write-Log "Found source directory: $sourceDir"
    } else {
        Write-Log "[ERROR] Could not find $ExeName"
        exit 1
    }

    # ===== Perform replacement =====
    # Files are now renamed to .old, safe to copy new files
    Write-Log "Starting to install new version..."
    
    # Delete renamed .old files and other old files (preserve external-resources and log files)
    Write-Log "Cleaning up old version files..."
    Get-ChildItem -Path $AppDir | Where-Object { 
        $_.Name -ne "external-resources" -and 
        $_.Name -notin $PreserveLogPatterns 
    } | ForEach-Object {
        try {
            if ($_.PSIsContainer) {
                Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction Stop
            } else {
                Remove-Item -Path $_.FullName -Force -ErrorAction Stop
            }
        } catch {
            Write-Log "[WARN] Deletion failed: $($_.FullName) - $($_.Exception.Message)"
        }
    }

    # Copy new files (exclude external-resources)
    Write-Log "Copying new version files..."
    Get-ChildItem -Path $sourceDir | Where-Object { $_.Name -ne "external-resources" } | ForEach-Object {
        $destPath = Join-Path $AppDir $_.Name
        Copy-Item -Path $_.FullName -Destination $destPath -Recurse -Force
    }
    Write-Log "File copy completed"

    # Restore user data
    if (Test-Path $backupDir) {
        if (-not (Test-Path $externalResources)) {
            Write-Log "Restoring user data..."
            Copy-Item -Path $backupDir -Destination $externalResources -Recurse -Force
            Write-Log "User data restoration completed"
        }
        # Clean up backup
        Remove-Item -Path $backupDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Verify installation
    $newExePath = Join-Path $AppDir $ExeName
    if (-not (Test-Path $newExePath)) {
        Write-Log "[ERROR] Installation verification failed: $ExeName does not exist"
        exit 1
    }
    Write-Log "Installation verification passed"

    # Clean up temporary files
    Write-Log "Cleaning up temporary files..."
    Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    
    # Clean up update config
    $configPath = Join-Path $env:APPDATA "ai-learning-assistant-launcher\\update-config.json"
    if (Test-Path $configPath) {
        Remove-Item -Path $configPath -Force -ErrorAction SilentlyContinue
    }
    $pendingZip = Join-Path $env:APPDATA "ai-learning-assistant-launcher\\pending-update.zip"
    if (Test-Path $pendingZip) {
        Remove-Item -Path $pendingZip -Force -ErrorAction SilentlyContinue
    }

    Write-Log "========== Update completed, starting new version =========="
    
    # Start new version
    Start-Process -FilePath $newExePath -WorkingDirectory $AppDir
    
    Write-Log "New version started"
    exit 0

} catch {
    Write-Log "[ERROR] Update failed: $($_.Exception.Message)"
    Write-Log "[ERROR] Stack trace: $($_.ScriptStackTrace)"
    
    # Try to restore .old files
    Write-Log "Attempting to restore renamed files..."
    Get-ChildItem -Path $AppDir -Filter "*.old" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $originalName = $_.FullName -replace '\\.old$', ''
        try {
            if (-not (Test-Path $originalName)) {
                Rename-Item -Path $_.FullName -NewName ([System.IO.Path]::GetFileName($originalName)) -Force
                Write-Log "[Restore] Restored: $originalName"
            }
        } catch {
            Write-Log "[WARN] Restoration failed: $($_.FullName)"
        }
    }
    
    # Try to start old version
    $oldExe = Join-Path $AppDir $ExeName
    if (Test-Path $oldExe) {
        Write-Log "Attempting to start old version..."
        Start-Process -FilePath $oldExe -WorkingDirectory $AppDir
    }
    exit 1
}
`;

  // 写入脚本文件，添加 UTF-8 BOM 防止中文路径或特殊字符导致解析失败
  const BOM = '\uFEFF';
  await writeFile(scriptPath, BOM + scriptContent, { encoding: 'utf8' });

  await writeUpdateLog('INFO', '[generatePowerShellUpdateScript] 脚本已生成', {
    scriptPath,
    logPath,
  });

  return scriptPath;
}

export async function installLauncherUpdate() {
  // 防止重复点击
  if (isInstallInProgress) {
    await writeUpdateLog(
      'WARN',
      '[installLauncherUpdate] 更新已在进行中，忽略重复调用',
    );
    return {
      success: false,
      message: '更新已在进行中，请勿重复点击',
    };
  }

  isInstallInProgress = true;

  await writeUpdateLog(
    'INFO',
    '[installLauncherUpdate] 开始执行两阶段更新（阶段一）',
  );

  // 如果是开发模式，不执行更新
  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    await writeUpdateLog(
      'WARN',
      '[installLauncherUpdate] 开发模式下不支持自动更新',
    );
    isInstallInProgress = false;
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

    // 等待一小段时间确保文件句柄释放
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 显示更新确认对话框
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '准备更新',
      message: '启动器将重启并应用更新',
      detail: `当前版本: ${currentVersion}\n新版本: ${version}\n\n点击"确定"后程序将重启，重启过程中会自动应用更新。`,
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response !== 0) {
      isInstallInProgress = false;
      await writeUpdateLog('INFO', '[installLauncherUpdate] 用户取消更新');
      return {
        success: false,
        message: '用户取消更新',
      };
    }

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 用户确认更新，开始准备更新文件',
    );

    // 获取应用目录
    const exePath = app.getPath('exe');
    const appDir = path.dirname(exePath);

    // ===== 生成并启动 PowerShell 更新脚本 =====
    await writeUpdateLog('INFO', '[installLauncherUpdate] 生成更新脚本...');
    const scriptPath = await generatePowerShellUpdateScript(
      zipPath,
      appDir,
      version,
      exePath,
    );

    // 验证脚本文件是否成功生成且可读
    try {
      await access(scriptPath, constants.R_OK);
      await writeUpdateLog('INFO', '[installLauncherUpdate] 脚本文件验证通过', {
        scriptPath,
      });
    } catch (err) {
      await writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 脚本文件验证失败，文件不存在或不可读',
        {
          scriptPath,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      throw new Error(`脚本文件验证失败: ${scriptPath}`);
    }

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 启动更新脚本 (使用 Start-Process 脱离 Job Object)...',
    );

    // ===== 关键：使用 PowerShell Start-Process 脱离 Job Object =====
    // Windows 会将子进程绑定到父进程的 Job Object 中，父进程退出时子进程也会被终止
    // 通过 PowerShell 的 Start-Process 启动的进程不会继承 Job Object，完全独立
    const isDebugMode = process.env.UPDATE_DEBUG === '1';
    const windowStyle = isDebugMode ? 'Normal' : 'Hidden';

    // 构建 Start-Process 命令，启动一个完全独立的 PowerShell 进程
    // -PassThru 返回进程对象以便获取 PID
    // 转义路径中的单引号
    const escapedScriptPath = scriptPath.replace(/'/g, "''");
    // PID 文件路径，作为 stdout 管道的可靠回退
    const pidFilePath = path.join(
      app.getPath('userData'),
      'update-temp',
      'update-pid.txt',
    );
    const escapedPidFilePath = pidFilePath
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''");

    // 单行命令，避免换行符导致 -Command 解析异常
    // 同时将 PID 写入文件作为回退（stdout 管道在 detached 模式下不可靠）
    const startProcessCommand = `$ErrorActionPreference='Stop'; $p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','${windowStyle}','-File','${escapedScriptPath}') -WindowStyle ${windowStyle} -PassThru; $p.Id | Out-File -FilePath '${escapedPidFilePath}' -NoNewline -Encoding UTF8; Write-Output $p.Id`;

    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      startProcessCommand,
    ];

    await writeUpdateLog(
      'DEBUG',
      `[installLauncherUpdate] 启动参数: 调试模式=${isDebugMode}`,
      {
        command: 'powershell.exe',
        startProcessCommand,
        windowStyle,
        pidFilePath,
      },
    );

    // ===== 使用 execFile 替代 spawn + pipe =====
    // execFile 更可靠地捕获 stdout/stderr，避免 detached+pipe 组合的管道丢失问题
    // 外层 PowerShell 只需运行 Start-Process 并返回 PID，不需要 detached
    // 真正的脱离 Job Object 由内层 Start-Process 完成
    const { stdout: stdoutData, stderr: stderrData } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('启动更新进程超时（15秒）'));
      }, 15000);

      execFile(
        'powershell.exe',
        args,
        {
          timeout: 15000,
          windowsHide: true,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          clearTimeout(timeout);
          if (error) {
            writeUpdateLog('ERROR', '[installLauncherUpdate] execFile 错误', {
              message: error.message,
              code: (error as any).code,
              killed: (error as any).killed,
              stdout,
              stderr,
            });
            reject(error);
          } else {
            resolve({ stdout: stdout || '', stderr: stderr || '' });
          }
        },
      );
    });

    await writeUpdateLog('DEBUG', '[installLauncherUpdate] PowerShell 输出', {
      stdout: stdoutData.trim(),
      stderr: stderrData.trim(),
    });

    // 解析输出获取新进程 PID
    let launchedPid = parseInt(stdoutData.trim(), 10);

    // 如果 stdout 解析失败，尝试从 PID 文件回退读取
    if (isNaN(launchedPid) || launchedPid <= 0) {
      await writeUpdateLog(
        'WARN',
        '[installLauncherUpdate] stdout 解析 PID 失败，尝试从文件回退读取',
        { stdout: stdoutData, pidFilePath },
      );
      try {
        if (existsSync(pidFilePath)) {
          const pidFromFile = readFileSync(pidFilePath, 'utf-8').trim();
          // 移除 UTF-8 BOM（如果存在）
          const cleanPid = pidFromFile.replace(/^\uFEFF/, '');
          launchedPid = parseInt(cleanPid, 10);
          await writeUpdateLog(
            'INFO',
            '[installLauncherUpdate] 从文件回退读取 PID 成功',
            { pid: launchedPid, raw: pidFromFile },
          );
        }
      } catch (pidFileErr) {
        await writeUpdateLog(
          'ERROR',
          '[installLauncherUpdate] 读取 PID 文件失败',
          {
            error:
              pidFileErr instanceof Error
                ? pidFileErr.message
                : String(pidFileErr),
          },
        );
      }
    }

    // 清理 PID 文件
    try {
      if (existsSync(pidFilePath)) {
        unlinkSync(pidFilePath);
      }
    } catch {
      // 忽略清理失败
    }

    if (isNaN(launchedPid) || launchedPid <= 0) {
      await writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 无法获取更新脚本进程 PID（stdout 和文件回退均失败）',
        { stdout: stdoutData, stderr: stderrData, pidFilePath },
      );
      throw new Error('无法获取更新脚本进程 PID');
    }

    await writeUpdateLog('INFO', '[installLauncherUpdate] 独立更新进程已启动', {
      launchedPid,
      scriptPath,
    });

    // ===== 验证独立进程确实在运行 =====
    const maxVerifyAttempts = 10;
    const verifyIntervalMs = 300;
    let verified = false;

    for (let i = 0; i < maxVerifyAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, verifyIntervalMs));

      try {
        // signal 0 只检查进程是否存在，不发送信号
        process.kill(launchedPid, 0);
        verified = true;
        await writeUpdateLog(
          'DEBUG',
          `[installLauncherUpdate] 进程验证成功 (尝试 ${i + 1}/${maxVerifyAttempts})`,
          { pid: launchedPid },
        );
        break;
      } catch {
        await writeUpdateLog(
          'WARN',
          `[installLauncherUpdate] 进程验证中 (尝试 ${i + 1}/${maxVerifyAttempts})`,
          { pid: launchedPid },
        );
      }
    }

    if (!verified) {
      await writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 更新进程验证失败，进程可能未成功启动',
      );
      throw new Error('更新进程启动验证失败');
    }

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 更新进程验证通过，准备退出主进程',
    );

    // 额外等待确保 PowerShell 脚本开始执行
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await writeUpdateLog('INFO', '[installLauncherUpdate] 准备退出应用...');

    // 设置 forceQuit 标志，绕过托盘最小化拦截，确保应用能正常退出
    setForceQuit(true);

    // 使用 app.exit(0) 而不是 app.quit()
    // app.quit() 会发出 before-quit 等事件并等待所有窗口关闭，可能因为 onbeforeunload 拦截而挂起
    // app.exit(0) 更彻底，不触发窗口关闭逻辑
    setTimeout(() => {
      app.exit(0);
    }, 500);

    return {
      success: true,
      message: '正在更新启动器...',
    };
  } catch (error) {
    isInstallInProgress = false;
    await writeUpdateLog(
      'ERROR',
      '[installLauncherUpdate] 两阶段更新（阶段一）失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}
