import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
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

const psDir = path.resolve(
  __dirname,
  '../../external-resources/local-ai-service/rts-service',
);

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
  单次获取RTS服务状态
*/
export async function getRTSServiceStatus(): Promise<string> {
  try {
    const { stdout } = await exec(
      'powershell',
      [
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `cd "${psDir}"; .\\get-service-status.ps1`,
      ],
      { encoding: 'utf8' },
    );

    const status = extractStatus(stdout);
    // 只在状态变化时打印日志
    if (status !== lastLoggedStatus) {
      logInfo('RTS服务状态:', status);
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
