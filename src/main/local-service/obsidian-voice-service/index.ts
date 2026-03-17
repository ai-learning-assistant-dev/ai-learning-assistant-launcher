import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
const exec = promisify(execFile);
import { IpcMain } from 'electron';
import { ipcHandle } from '../../ipc-util';
import {
  getObsidianVoiceServiceStatusHandle,
  installObsidianVoiceServiceHandle,
  runObsidianVoiceServiceHandle,
  stopObsidianVoiceServiceHandle,
} from './type-info';
import { appPath } from '../../exec';

export default function init(ipcMain: IpcMain): void {
  ipcHandle(
    ipcMain,
    getObsidianVoiceServiceStatusHandle,
    getObsidianVoiceServiceStatus,
  );
  ipcHandle(
    ipcMain,
    installObsidianVoiceServiceHandle,
    installObsidianVoiceService,
  );
  ipcHandle(ipcMain, runObsidianVoiceServiceHandle, runObsidianVoiceService);
  ipcHandle(ipcMain, stopObsidianVoiceServiceHandle, stopObsidianVoiceService);
}

const psDir = path.join(
  appPath,
  'external-resources',
  'local-ai-service',
  'obsidian-voice-service',
);

export async function getObsidianVoiceServiceStatus(): Promise<string> {
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
    return stdout.trim();
  } catch (e: any) {
    console.error('getObsidianVoiceServiceStatus failed:', e.message);
    console.error('status stderr:', e.stderr?.toString());
    return 'unknown';
  }
}

export async function installObsidianVoiceService(): Promise<string> {
  try {
    const { stdout } = await exec(
      'powershell',
      [
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `cd "${psDir}"; .\\install.ps1`,
      ],
      { encoding: 'utf8' },
    );
    return stdout.trim();
  } catch (e: any) {
    console.error('installObsidianVoiceService failed:', e.message);
    console.error('install stderr:', e.stderr?.toString());
    return 'unknown';
  }
}

export async function runObsidianVoiceService(): Promise<string> {
  try {
    const { stdout } = await exec(
      'powershell',
      [
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `cd "${psDir}"; .\\run.ps1`,
      ],
      { encoding: 'utf8' },
    );
    return stdout.trim();
  } catch (e: any) {
    console.error('runObsidianVoiceService failed:', e.message);
    console.error('run stderr:', e.stderr?.toString());
    return 'unknown';
  }
}

export async function stopObsidianVoiceService(): Promise<string> {
  try {
    const { stdout } = await exec(
      'powershell',
      [
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `cd "${psDir}"; .\\stop.ps1`,
      ],
      { encoding: 'utf8' },
    );
    return stdout.trim();
  } catch (e: any) {
    console.error('stopObsidianVoiceService failed:', e.message);
    console.error('stop stderr:', e.stderr?.toString());
    return 'unknown';
  }
}
