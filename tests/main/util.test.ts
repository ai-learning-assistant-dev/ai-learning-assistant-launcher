/**
 * 主进程工具函数单元测试
 * 真实导入 src/main/util.ts 中的函数
 */
import { describe, it, expect } from 'vitest';
import { wait, onlyAlphaNumericLine, resolveHtmlPath } from '../../src/main/util';

describe('util.ts 工具函数', () => {
  describe('wait', () => {
    it('应该在指定时间后 resolve', async () => {
      const start = Date.now();
      await wait(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(90); // 允许小误差
      expect(elapsed).toBeLessThan(200);
    });

    it('应该能等待 0ms', async () => {
      const start = Date.now();
      await wait(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('onlyAlphaNumericLine', () => {
    it('应该过滤非字母数字字符', () => {
      expect(onlyAlphaNumericLine('hello world!')).toBe('helloworld');
      expect(onlyAlphaNumericLine('test@#$%123')).toBe('test123');
      expect(onlyAlphaNumericLine('中文测试abc')).toBe('abc');
    });

    it('应该保留路径分隔符和下划线', () => {
      // 正则 [^a-zA-Z0-9_/\\] 保留字母数字、下划线、正斜杠、反斜杠
      expect(onlyAlphaNumericLine('/path/to/file')).toBe('/path/to/file');
      expect(onlyAlphaNumericLine('/path_with_underscore')).toBe('/path_with_underscore');
      expect(onlyAlphaNumericLine('file_name_123')).toBe('file_name_123');
      // 反斜杠和正斜杠
      expect(onlyAlphaNumericLine('path\\to\\file')).toBe('path\\to\\file');
      expect(onlyAlphaNumericLine('path/to/file')).toBe('path/to/file');
    });

    it('应该处理空字符串', () => {
      expect(onlyAlphaNumericLine('')).toBe('');
    });

    it('应该处理纯特殊字符', () => {
      expect(onlyAlphaNumericLine('!@#$%^&*()')).toBe('');
    });
  });

  describe('resolveHtmlPath', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalPort = process.env.PORT;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      process.env.PORT = originalPort;
    });

    it('生产环境应该返回 file:// 协议路径', () => {
      process.env.NODE_ENV = 'production';
      const result = resolveHtmlPath('index.html');
      expect(result).toMatch(/^file:\/\//);
      expect(result).toContain('index.html');
    });

    it('开发环境应该返回 localhost URL', () => {
      process.env.NODE_ENV = 'development';
      process.env.PORT = '3000';
      const result = resolveHtmlPath('index.html');
      expect(result).toMatch(/^http:\/\/localhost:3000\/index\.html$/);
    });

    it('开发环境应该使用默认端口 1212', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.PORT;
      const result = resolveHtmlPath('index.html');
      expect(result).toContain(':1212');
    });
  });
});
