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
    console.log('getRTSServiceStatus ', stdout);
    const status = extractStatus(stdout);
    return status;
  } catch (e: any) {
    // 把 PowerShell 的具体错误打印出来
    console.error('PS exit code:', e.code);
    console.error('PS stderr:', e.stderr?.toString());
    console.error('PS stdout:', e.stdout?.toString());
    return 'unknown';
  }
}
// TODO install
export async function installRTSService(): Promise<string> {
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
        const progress = parseProgressLine(trimmed, 'install');
        if (progress) {
          console.log('Install progress:', progress);
          sendProgressToRenderer(progress);
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      stderrData += data.toString();
    });

    child.on('close', (code) => {
      console.log('install RTS Service result,', stdoutData.trim());
      if (code !== 0) {
        console.error('install exit code:', code);
        console.error('install stderr:', stderrData);
      }
      const status = extractStatus(stdoutData);
      resolve(status || 'unknown');
    });

    child.on('error', (err) => {
      console.error('install error:', err.message);
      resolve('unknown');
    });
  });
}

// TODO run
export async function runRTSService(): Promise<string> {
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
        // Print python.exe path length info
        if (trimmed.startsWith('PYTHON_PATH_INFO:')) {
          console.log('[RTS]', trimmed);
          // Parse path length and check Windows limit (260 chars)
          const match = trimmed.match(/\(length:\s*(\d+)\)/);
          if (match) {
            const pathLength = parseInt(match[1], 10);
            if (pathLength > 260) {
              const errorMsg = `python.exe 路径过长（当前 ${pathLength} 个字符，上限 260 个字符），可能导致 Windows 加载 DLL 失败。请将启动器移动到较短路径，例如 D:\\ALA\\`;
              console.error('[RTS] Path too long:', pathLength);
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
          console.log('Run progress:', progress);
          sendProgressToRenderer(progress);
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      stderrData += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('run exit code:', code);
        console.error('run stderr:', stderrData);
      }
      const status = extractStatus(stdoutData);
      resolve(status || 'unknown');
    });

    child.on('error', (err) => {
      console.error('run error:', err.message);
      resolve('unknown');
    });
  });
}

// TODO stop
export async function stopRTSService(): Promise<string> {
  try {
    const { stdout } = await exec(
      'powershell',
      ['-ExecutionPolicy', 'Bypass', '-Command', `cd "${psDir}"; .\\stop.ps1`],
      { encoding: 'utf8' },
    );
    const status = extractStatus(stdout);
    return status; // "success"
  } catch (e: any) {
    console.error('stop failed:', e.message);
    console.error('stop exit code:', e.code);
    console.error('stop stderr:', e.stderr?.toString());
    console.error('stop stdout:', e.stdout?.toString());
    return 'unknown';
  }
}

// TODO uninstall

// TODO update
