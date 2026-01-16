import { dialog, IpcMain } from 'electron';
import { selectFolderHandle, getDiskInfoHandle, DiskInfo } from './type-info';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { ipcHandle } from '../ipc-util';

const execPromise = promisify(exec);

// 获取Windows磁盘信息
async function getWindowsDiskInfo(diskPath: string): Promise<DiskInfo> {
  try {
    // 获取盘符，例如 "C:" 或 "D:"
    const driveLetter = path.parse(diskPath).root.replace('\\', '');
    
    // 使用 wmic 命令获取磁盘信息
    const { stdout } = await execPromise(
      `wmic logicaldisk where "DeviceID='${driveLetter}'" get Size,FreeSpace /format:csv`,
      { encoding: 'utf8' }
    );
    
    const lines = stdout.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('无法获取磁盘信息');
    }
    
    // CSV格式: Node,FreeSpace,Size
    const values = lines[1].split(',');
    const freeSpace = parseInt(values[1], 10) || 0;
    const totalSize = parseInt(values[2], 10) || 0;
    
    return {
      total: totalSize,
      free: freeSpace,
      used: totalSize - freeSpace,
    };
  } catch (error) {
    console.error('获取磁盘信息失败:', error);
    // 返回默认值
    return {
      total: 500 * 1024 * 1024 * 1024, // 500GB
      free: 200 * 1024 * 1024 * 1024,  // 200GB
      used: 300 * 1024 * 1024 * 1024,  // 300GB
    };
  }
}

export function setupJointBuildHandlers(ipcMain: IpcMain): void {
  // 处理选择文件夹
  ipcHandle(ipcMain, selectFolderHandle, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: 'C:\\', // Windows默认从C盘开始
      title: '选择共建计划存储路径',
    });
    
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    
    return result.filePaths[0];
  });
  
  // 处理获取磁盘信息
  ipcHandle(ipcMain, getDiskInfoHandle, async (_event, diskPath: string) => {
    return getWindowsDiskInfo(diskPath);
  });
}
