/**
 * IPC 工具模块测试示例
 * 展示如何测试与 Electron 相关的逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 Electron 的 ipcMain 模块
const mockIpcMain = {
  on: vi.fn(),
  handle: vi.fn(),
};

// 模拟 electron 模块
vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
}));

// 示例：IPC 通道名称验证函数
function validateIpcChannel(channel: string): boolean {
  // 通道名称规范：小写字母、数字、连字符
  return /^[a-z0-9-]+$/.test(channel) && channel.length > 0;
}

// 示例：IPC 消息构造器
function createIpcMessage<T>(
  type: 'ERROR' | 'INFO' | 'WARNING' | 'DATA' | 'PROGRESS',
  payload: T,
  requestId?: string
) {
  return {
    type,
    payload,
    requestId: requestId || `req-${Date.now()}`,
    timestamp: Date.now(),
  };
}

describe('IPC 工具测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateIpcChannel', () => {
    it('应该接受有效的通道名称', () => {
      expect(validateIpcChannel('docker')).toBe(true);
      expect(validateIpcChannel('wsl')).toBe(true);
      expect(validateIpcChannel('training-service')).toBe(true);
      expect(validateIpcChannel('obsidian-plugin')).toBe(true);
      expect(validateIpcChannel('lm-studio')).toBe(true);
    });

    it('应该拒绝无效的通道名称', () => {
      expect(validateIpcChannel('')).toBe(false);
      expect(validateIpcChannel('InvalidName')).toBe(false);
      expect(validateIpcChannel('invalid_name')).toBe(false);
      expect(validateIpcChannel('space name')).toBe(false);
      expect(validateIpcChannel('special!char')).toBe(false);
    });
  });

  describe('createIpcMessage', () => {
    it('应该创建正确的消息结构', () => {
      const message = createIpcMessage('DATA', { foo: 'bar' }, 'test-id');

      expect(message).toHaveProperty('type', 'DATA');
      expect(message).toHaveProperty('payload', { foo: 'bar' });
      expect(message).toHaveProperty('requestId', 'test-id');
      expect(message).toHaveProperty('timestamp');
      expect(typeof message.timestamp).toBe('number');
    });

    it('应该在没有 requestId 时自动生成', () => {
      const message = createIpcMessage('INFO', 'test payload');

      expect(message.requestId).toMatch(/^req-\d+$/);
    });

    it('应该支持所有消息类型', () => {
      const types = ['ERROR', 'INFO', 'WARNING', 'DATA', 'PROGRESS'] as const;

      types.forEach((type) => {
        const message = createIpcMessage(type, null);
        expect(message.type).toBe(type);
      });
    });
  });

  describe('IPC 注册模拟', () => {
    it('应该能够注册 IPC 处理器', () => {
      const handler = vi.fn();
      mockIpcMain.on('test-channel', handler);

      expect(mockIpcMain.on).toHaveBeenCalledWith('test-channel', handler);
    });

    it('应该能够注册 IPC 异步处理器', () => {
      const handler = vi.fn().mockResolvedValue('result');
      mockIpcMain.handle('test-invoke', handler);

      expect(mockIpcMain.handle).toHaveBeenCalledWith('test-invoke', handler);
    });
  });
});
