/**
 * WSL 相关功能单元测试示例
 * 测试 src/main/cmd/ 目录下的 WSL 检测逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 child_process 模块
const mockExec = vi.fn();
vi.mock('child_process', () => ({
  exec: mockExec,
  execSync: vi.fn(),
}));

// 示例：WSL 检测函数（基于实际项目的 is-wsl-install.ts 逻辑）
async function checkWSLInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    mockExec('wsl --list', (error: Error | null) => {
      resolve(!error);
    });
  });
}

// 示例：WSL 版本检测
async function getWSLVersion(): Promise<{ wsl: number; kernel: string } | null> {
  return new Promise((resolve) => {
    mockExec('wsl --version', (error: Error | null, stdout: string) => {
      if (error) {
        resolve(null);
        return;
      }
      
      // 简单解析版本信息
      const wslMatch = stdout.match(/WSL version:\s*(\d+\.\d+)/);
      const kernelMatch = stdout.match(/Kernel version:\s*([\d.]+)/);
      
      resolve({
        wsl: wslMatch ? parseFloat(wslMatch[1]) : 0,
        kernel: kernelMatch ? kernelMatch[1] : 'unknown',
      });
    });
  });
}

describe('WSL 检测测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkWSLInstalled', () => {
    it('应该在 WSL 已安装时返回 true', async () => {
      mockExec.mockImplementation((cmd: string, callback: Function) => {
        callback(null, 'Windows Subsystem for Linux Distributions:');
      });

      const result = await checkWSLInstalled();
      expect(result).toBe(true);
    });

    it('应该在 WSL 未安装时返回 false', async () => {
      mockExec.mockImplementation((cmd: string, callback: Function) => {
        callback(new Error('wsl 不是内部或外部命令'));
      });

      const result = await checkWSLInstalled();
      expect(result).toBe(false);
    });

    it('应该使用正确的命令', async () => {
      mockExec.mockImplementation((cmd: string, callback: Function) => {
        callback(null, '');
      });

      await checkWSLInstalled();
      expect(mockExec).toHaveBeenCalledWith(
        'wsl --list',
        expect.any(Function)
      );
    });
  });

  describe('getWSLVersion', () => {
    it('应该正确解析 WSL 版本信息', async () => {
      const mockOutput = `
WSL version: 2.0.14.0
Kernel version: 5.15.133.1-1
WSLg version: 1.0.59
MSRDC version: 1.2.4677
Direct3D version: 1.611.1-81528511
DXCore version: 10.0.25131.1002-220531-1700.rs-onecore-dep2
Windows version: 10.0.22631.3737
      `;

      mockExec.mockImplementation((cmd: string, callback: Function) => {
        callback(null, mockOutput);
      });

      const result = await getWSLVersion();
      expect(result).toEqual({
        wsl: 2.0,
        kernel: '5.15.133.1',
      });
    });

    it('应该在命令失败时返回 null', async () => {
      mockExec.mockImplementation((cmd: string, callback: Function) => {
        callback(new Error('Command failed'));
      });

      const result = await getWSLVersion();
      expect(result).toBeNull();
    });

    it('应该处理旧版 WSL 输出格式', async () => {
      mockExec.mockImplementation((cmd: string, callback: Function) => {
        callback(null, 'Command not recognized');
      });

      const result = await getWSLVersion();
      expect(result).toEqual({
        wsl: 0,
        kernel: 'unknown',
      });
    });
  });
});
