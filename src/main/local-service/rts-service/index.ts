import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import net from 'net';
const exec = promisify(execFile);
import { IpcMain, BrowserWindow } from 'electron';
import { ipcHandle } from '../../ipc-util';
import {
  getRTSServiceStatusHandle,
  installRTSServiceHandle,
  runRTSServiceHandle,
  stopRTSServiceHandle,
  rtsProgressChannel,
  RTSProgressInfo,
} from './type-info';
import { appPath } from '../../exec';

// 日志前缀标签
const LOG_TAG = '[RTS-Service]';

// 格式化时间戳
function timestamp(): string {
  return new Date().toISOString().substring(11, 23);
}

// 统一日志函数
function logInfo(message: string, ...args: unknown[]): void {
  console.log(`${timestamp()} ${LOG_TAG} ${message}`, ...args);
}

function logError(message: string, ...args: unknown[]): void {
  console.error(`${timestamp()} ${LOG_TAG} ERROR: ${message}`, ...args);
}

// 缓存上次状态，避免重复日志
let lastLoggedStatus = '';

export default function init(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, getRTSServiceStatusHandle, getRTSServiceStatus);
  ipcHandle(ipcMain, installRTSServiceHandle, installRTSService);
  ipcHandle(ipcMain, runRTSServiceHandle, runRTSService);
  ipcHandle(ipcMain, stopRTSServiceHandle, stopRTSService);
}

const psDir = path.join(
  appPath,
  'external-resources',
  'local-ai-service',
  'rts-service',
);

// RTS服务配置（必须与PowerShell脚本保持一致）
// install.ps1 和 run.ps1 中的 $extractedDir = "rtc-backend"
const RTS_CONFIG = {
  extractedDir: 'rtc-backend',
  statusFile: 'service-status.json',
  port: 8989,  // 与 run.ps1 中的 $Port 保持一致
};

// 检查端口是否被占用
function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    socket.setTimeout(1000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve(true); // 端口被占用
    });
    
    socket.on('error', () => {
      resolve(false); // 端口空闲
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(port, '127.0.0.1');
  });
}

// 检查进程是否存在
function isProcessRunning(pid: number): boolean {
  try {
    // signal 0 不会真的杀死进程，只是测试进程是否存在
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Extract last non-empty line from stdout (filter out debug output)
function extractStatus(stdout: string): string {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('PROGRESS:'));
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

// 发送进度事件到所有渲染进程
function sendProgressToRenderer(progressInfo: RTSProgressInfo): void {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(rtsProgressChannel, progressInfo);
    }
  });
}

// 解析进度 JSON
function parseProgressLine(
  line: string,
  operation: 'install' | 'run',
): RTSProgressInfo | null {
  if (line.startsWith('PROGRESS:')) {
    try {
      const jsonStr = line.substring('PROGRESS:'.length);
      const data = JSON.parse(jsonStr);
      return {
        type: 'progress',
        percent: data.percent || 0,
        stage: data.stage || '',
        message: data.message || '',
        operation,
      };
    } catch (e) {
      console.error('Failed to parse progress JSON:', e);
    }
  }
  return null;
}

/* 
  单次获取RTS服务状态（TypeScript实现，替代PowerShell脚本）
*/
export async function getRTSServiceStatus(): Promise<string> {
  try {
    const backendDir = path.join(psDir, RTS_CONFIG.extractedDir);
    const statusFilePath = path.join(psDir, RTS_CONFIG.statusFile);

    // 1. 检查后端目录是否存在
    if (!fs.existsSync(backendDir)) {
      const status = 'not_installed';
      if (status !== lastLoggedStatus) {
        logInfo('RTS服务状态:', status);
        lastLoggedStatus = status;
      }
      return status;
    }

    // 2. 检查状态文件是否存在
    if (!fs.existsSync(statusFilePath)) {
      const status = 'stopped';
      if (status !== lastLoggedStatus) {
        logInfo('RTS服务状态:', status, '(文件不存在:', statusFilePath, ')');
        lastLoggedStatus = status;
      }
      return status;
    }

    // 3. 读取并解析状态文件
    let statusData: { status?: string; pid?: number };
    try {
      let fileContent = fs.readFileSync(statusFilePath, 'utf8');
      // 去除 BOM (Byte Order Mark) - PowerShell 写入的 UTF8 文件可能带有 BOM
      fileContent = fileContent.replace(/^\uFEFF/, '');
      statusData = JSON.parse(fileContent);
    } catch (e: any) {
      logError('读取或解析状态文件失败:', e.message);
      const status = 'error';
      if (status !== lastLoggedStatus) {
        logInfo('RTS服务状态:', status);
        lastLoggedStatus = status;
      }
      return status;
    }

    // 4. 如果状态是 starting，检查端口是否已被占用
    if (statusData.status === 'starting') {
      const isPortInUse = await checkPortInUse(RTS_CONFIG.port);
      const status = isPortInUse ? 'running' : 'starting';
      if (status !== lastLoggedStatus) {
        logInfo('RTS服务状态:', status);
        lastLoggedStatus = status;
      }
      return status;
    }

    // 5. 如果存在 PID，检查进程是否存在
    // 注意：PowerShell 中 pid 可能是 null，需要检查
    if (statusData.pid && typeof statusData.pid === 'number' && statusData.pid > 0) {
      if (!isProcessRunning(statusData.pid)) {
        const status = 'stopped';
        if (status !== lastLoggedStatus) {
          logInfo('RTS服务状态:', status, '(PID', statusData.pid, '不存在)');
          lastLoggedStatus = status;
        }
        return status;
      }
    }

    // 6. 检查端口是否被占用
    const isPortInUse = await checkPortInUse(RTS_CONFIG.port);
    if (isPortInUse) {
      const status = 'running';
      if (status !== lastLoggedStatus) {
        logInfo('RTS服务状态:', status);
        lastLoggedStatus = status;
      }
      return status;
    }

    // 7. 返回状态文件中的状态或默认 stopped
    const status = statusData.status || 'stopped';
    if (status !== lastLoggedStatus) {
      logInfo('RTS服务状态:', status, '(来自文件)');
      lastLoggedStatus = status;
    }
    return status;
  } catch (e: any) {
    logError('获取RTS状态失败:', e.message);
    return 'unknown';
  }
}
// 安装RTS服务
export async function installRTSService(): Promise<string> {
  logInfo('========== 开始安装RTS服务 ==========');
  logInfo('PowerShell脚本目录:', psDir);
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn(
      'powershell',
      [
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `cd "${psDir}"; .\\install.ps1`,
      ],
      { shell: true },
    );

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdoutData += text;

      // 解析每一行检查是否有进度信息
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const progress = parseProgressLine(trimmed, 'install');
        if (progress) {
          logInfo(
            '安装进度:',
            `${progress.percent}% - ${progress.stage} - ${progress.message}`,
          );
          sendProgressToRenderer(progress);
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrData += text;
    });

    child.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logInfo('========== 安装完成 ==========');
      logInfo('耗时:', `${elapsed}秒`);
      logInfo('退出码:', code);

      // 打印最终结果摘要
      const status = extractStatus(stdoutData);
      logInfo('安装结果:', status);

      if (code !== 0) {
        logError('安装失败，退出码非零:', code);
        if (stderrData) {
          logError('stderr摘要:', stderrData.substring(0, 500));
        }
      }

      resolve(status || 'unknown');
    });

    child.on('error', (err) => {
      logError('安装进程启动失败:', err.message);
      resolve('unknown');
    });
  });
}

// 启动RTS服务
export async function runRTSService(): Promise<string> {
  logInfo('========== 开始启动RTS服务 ==========');
  logInfo('PowerShell脚本目录:', psDir);
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn(
      'powershell',
      ['-ExecutionPolicy', 'Bypass', '-Command', `cd "${psDir}"; .\\run.ps1`],
      { shell: true },
    );

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdoutData += text;

      // 解析每一行检查是否有进度信息
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 检查 Python 路径长度是否超限
        if (trimmed.startsWith('PYTHON_PATH_INFO:')) {
          const match = trimmed.match(/\(length:\s*(\d+)\)/);
          if (match) {
            const pathLength = parseInt(match[1], 10);
            if (pathLength > 260) {
              const errorMsg = `python.exe 路径过长（当前 ${pathLength} 个字符，上限 260 个字符），可能导致 Windows 加载 DLL 失败。请将启动器移动到较短路径，例如 D:\\ALA\\`;
              logError('路径过长:', pathLength);
              sendProgressToRenderer({
                type: 'progress',
                percent: 0,
                stage: 'path_error',
                message: errorMsg,
                operation: 'run',
              });
            }
          }
        }

        const progress = parseProgressLine(trimmed, 'run');
        if (progress) {
          logInfo(
            '启动进度:',
            `${progress.percent}% - ${progress.stage} - ${progress.message}`,
          );
          sendProgressToRenderer(progress);
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrData += text;
    });

    child.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logInfo('========== 启动完成 ==========');
      logInfo('耗时:', `${elapsed}秒`);
      logInfo('退出码:', code);

      const status = extractStatus(stdoutData);
      logInfo('启动结果:', status);

      if (code !== 0) {
        logError('启动失败，退出码非零:', code);
        if (stderrData) {
          logError('stderr摘要:', stderrData.substring(0, 500));
        }
      }
      resolve(status || 'unknown');
    });

    child.on('error', (err) => {
      logError('启动进程失败:', err.message);
      resolve('unknown');
    });
  });
}

// 停止RTS服务
export async function stopRTSService(): Promise<string> {
  logInfo('停止RTS服务...');
  const startTime = Date.now();

  try {
    const { stdout } = await exec(
      'powershell',
      ['-ExecutionPolicy', 'Bypass', '-Command', `cd "${psDir}"; .\\stop.ps1`],
      { encoding: 'utf8' },
    );

    const status = extractStatus(stdout);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logInfo('停止完成:', status, `(${elapsed}秒)`);

    return status; // "success"
  } catch (e: any) {
    logError('停止服务失败:', e.message);
    return 'unknown';
  }
}

// TODO uninstall

// TODO update
