import { IpcMain } from 'electron';
import { spawn } from 'node:child_process';
import { appPath, bunPath, bunGlobalBinDir } from '../exec';
import { ipcHandle } from '../ipc-util';
import { openBunDebugHandle } from './type-info';

export default function init(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, openBunDebugHandle, async () => {
    openBunDebugWindow();
  });
}

// 打开一个带项目内 bun 命令与 bun 全局目录环境变量的 cmd 窗口（调试用）
function openBunDebugWindow(): void {
  const env = {
    ...process.env,
    // 项目内 bun 命令目录 + bun 全局目录 + 原 PATH
    PATH: [bunPath, bunGlobalBinDir, process.env.PATH || '']
      .filter(Boolean)
      .join(';'),
    BUN_INSTALL: bunGlobalBinDir,
  };

  // 通过 cmd 内建命令 start 打开新的 cmd 窗口（/K 保持窗口不关闭）
  const child = spawn('cmd.exe', ['/C', 'start', 'cmd.exe', '/K'], {
    cwd: appPath,
    windowsHide: true,
    env,
  });

  child.on('error', (err) => {
    console.warn('打开 bun 调试窗口失败:', err);
  });
}
