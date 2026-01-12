import { execFile, execFileSync  } from 'child_process';
import { promisify } from 'util';
import path from 'path';
const exec = promisify(execFile);
import { IpcMain } from 'electron';
import { ipcHandle } from '../../ipc-util';
import { getRTSServiceStatusHandle } from './type-info';

export default function init(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, getRTSServiceStatusHandle, getRTSServiceStatus);
}

const psDir = path.resolve(__dirname,
  '../../external-resources/local-ai-service/rts-service');

/* 
  单次获取RTS服务状态
*/
export async function getRTSServiceStatus(): Promise<string> {
  try {
    const { stdout, stderr } = await exec('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `cd "${psDir}"; .\\get-service-status.ps1`
    ], { encoding: 'utf8' });
    console.log("ps stdout",stdout)
    if (stderr) console.warn('PS stderr:', stderr);
    console.log("stdout.trim():",stdout.trim())
    return stdout.trim();
  } catch (e: any) {
    // 把 PowerShell 的具体错误打印出来
    console.error('PS exit code:', e.code);
    console.error('PS stderr:', e.stderr?.toString());
    console.error('PS stdout:', e.stdout?.toString());
    return 'unknown';
  }
}

// TODO check service status

// TODO install 

// TODO run

// TODO stop

// TODO delete

// TODO update
