/**
 * IPC 工具模块测试
 * 真实导入 src/main/ipc-util.ts 并 mock electron
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron 模块
const mockIpcMain = {
  handle: vi.fn(),
};

vi.mock('electron', () => ({
  IpcMain: vi.fn(),
  ipcMain: mockIpcMain,
}));

// 在 mock 之后导入被测函数
import { ipcHandle } from '../../src/main/ipc-util';

describe('ipc-util.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ipcHandle', () => {
    it('应该注册 IPC 处理器', () => {
      const listener = vi.fn().mockResolvedValue('success');
      
      ipcHandle(mockIpcMain as any, 'test-channel', listener);
      
      expect(mockIpcMain.handle).toHaveBeenCalledWith('test-channel', expect.any(Function));
    });

    it('处理器应该返回成功结果', async () => {
      const listener = vi.fn().mockResolvedValue('test-result');
      
      ipcHandle(mockIpcMain as any, 'test-channel', listener);
      
      // 获取注册的处理器函数
      const registeredHandler = mockIpcMain.handle.mock.calls[0][1];
      const result = await registeredHandler({}, 'arg1', 'arg2');
      
      expect(result).toEqual({ result: 'test-result' });
      expect(listener).toHaveBeenCalledWith({}, 'arg1', 'arg2');
    });

    it('处理器应该捕获错误并返回错误对象', async () => {
      const error = new Error('test error');
      const listener = vi.fn().mockRejectedValue(error);
      
      ipcHandle(mockIpcMain as any, 'test-channel', listener);
      
      const registeredHandler = mockIpcMain.handle.mock.calls[0][1];
      const result = await registeredHandler({});
      
      expect(result).toHaveProperty('error');
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('test error');
    });

    it('处理器应该处理非 Error 类型的异常', async () => {
      const listener = vi.fn().mockRejectedValue('string error');
      
      ipcHandle(mockIpcMain as any, 'test-channel', listener);
      
      const registeredHandler = mockIpcMain.handle.mock.calls[0][1];
      const result = await registeredHandler({});
      
      expect(result).toHaveProperty('error');
      expect(result.error).toEqual({ message: 'string error' });
    });

    it('处理器应该处理同步函数', async () => {
      const listener = vi.fn().mockReturnValue('sync-result');
      
      ipcHandle(mockIpcMain as any, 'test-channel', listener);
      
      const registeredHandler = mockIpcMain.handle.mock.calls[0][1];
      const result = await registeredHandler({});
      
      expect(result).toEqual({ result: 'sync-result' });
    });
  });
});
