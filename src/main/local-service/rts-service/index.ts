import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
const exec = promisify(execFile);
import { IpcMain } from 'electron';
import { ipcHandle } from '../../ipc-util';
import { getRTSServiceStatusHandle, installRTSServiceHandle, runRTSServiceHandle, stopRTSServiceHandle } from './type-info';

export default function init(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, getRTSServiceStatusHandle, getRTSServiceStatus);
  ipcHandle(ipcMain, installRTSServiceHandle, installRTSService);
  ipcHandle(ipcMain, runRTSServiceHandle, runRTSService);
  ipcHandle(ipcMain, stopRTSServiceHandle, stopRTSService);
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
    console.log("getRTSServiceStatus ",stdout)
    // if (stderr) console.warn('PS stderr:', stderr);
    // console.log("stdout.trim():",stdout.trim())
    return stdout.trim();
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
  try {
    const { stdout } = await exec('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `cd "${psDir}"; .\\install.ps1`
    ], { encoding: 'utf8' });
    console.log("install RTS Service result,",stdout.trim())
    return stdout.trim();   // "success" | "error"
  } catch (e: any) {
    console.error('install exit code:', e.code);
    console.error('install stderr:', e.stderr?.toString());
    console.error('install stdout:', e.stdout?.toString());
    return 'unknown';
  }
}

// TODO run
export async function runRTSService(): Promise<string> {
  try {
    const { stdout } = await exec('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `cd "${psDir}"; .\\run.ps1`
    ], { encoding: 'utf8' });
    return stdout.trim();   // "success" | "error"
  } catch (e: any) {
    console.error('run failed:', e.message);
    console.error('run exit code:', e.code);
    console.error('run stderr:', e.stderr?.toString());
    console.error('run stdout:', e.stdout?.toString());
    return 'unknown';
  }
}

// TODO stop
export async function stopRTSService(): Promise<string> {
  try {
    const { stdout } = await exec('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-Command', `cd "${psDir}"; .\\stop.ps1`
    ], { encoding: 'utf8' });
    return stdout.trim();   // "success"
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
