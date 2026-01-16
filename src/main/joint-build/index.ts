import { dialog, IpcMain, Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { selectFolderHandle, getDiskInfoHandle, DiskInfo, setTrayEnabledHandle } from './type-info';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { ipcHandle } from '../ipc-util';

const execPromise = promisify(exec);

// 托盘实例
let tray: Tray | null = null;
// 是否启用托盘（共建开关状态）
let trayEnabled = false;
// 是否正在强制退出
let forceQuit = false;

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

  // 处理设置托盘启用状态
  ipcHandle(ipcMain, setTrayEnabledHandle, async (_event, enabled: boolean) => {
    trayEnabled = enabled;
    if (enabled) {
      createTray();
    } else {
      destroyTray();
    }
    return true;
  });
}

// 获取图标路径
function getIconPath(): string {
  // 开发环境和生产环境的路径不同
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons', 'icon.png');
  } else {
    return path.join(__dirname, '..', '..', 'icons', 'icon.png');
  }
}

// 创建托盘
function createTray(): void {
  if (tray) return;
  
  try {
    const iconPath = getIconPath();
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          const windows = BrowserWindow.getAllWindows();
          if (windows.length > 0) {
            const mainWindow = windows[0];
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          forceQuit = true;
          app.quit();
        },
      },
    ]);
    
    // todo: 信息识别
    const version = app.getVersion();
    const isJointBuilding = trayEnabled ? '正在共建中（ON）' : '共建已关闭（OFF）';
    const currentUploadSpeed = '0KB/s';
    const linkedTo = 0;
    tray.setToolTip(`AI学习助手 ${version}\n${isJointBuilding}\n当前上传速度: ${currentUploadSpeed}\n已连接伙伴${linkedTo}人`);
    tray.setContextMenu(contextMenu);
    
    // 双击托盘图标显示窗口
    tray.on('double-click', () => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const mainWindow = windows[0];
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.error('创建托盘失败:', error);
  }
}

// 销毁托盘
function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// 设置窗口关闭行为
export function setupWindowCloseHandler(mainWindow: BrowserWindow): void {
  mainWindow.on('close', (event) => {
    if (trayEnabled && !forceQuit) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// 检查是否强制退出
export function isForceQuit(): boolean {
  return forceQuit;
}

// 设置强制退出标志
export function setForceQuit(value: boolean): void {
  forceQuit = value;
}

// 获取托盘启用状态
export function isTrayEnabled(): boolean {
  return trayEnabled;
}
