/**
 * WSL 检测功能测试
 * 由于 is-wsl-install.ts 依赖 electron 的 Exec 类
 * 这里我们测试 WSL 版本解析逻辑
 */
import { describe, it, expect } from 'vitest';

// 从 is-wsl-install.ts 提取的版本解析逻辑
function parseWSLVersion(output: string): { version: string; kernel: string } | null {
  const versionMatch = output.match(/WSL version:\s*([\d.]+)/);
  const kernelMatch = output.match(/Kernel version:\s*([\d.]+)/);
  
  if (!versionMatch) return null;
  
  return {
    version: versionMatch[1],
    kernel: kernelMatch ? kernelMatch[1] : 'unknown',
  };
}

function parseVTStatus(output: string): boolean {
  if (
    output.indexOf('Virtualization Enabled In Firmware: No') >= 0 ||
    output.indexOf('固件中已启用虚拟化: 否') >= 0
  ) {
    return false;
  }
  return true;
}

describe('WSL 工具函数', () => {
  describe('parseWSLVersion', () => {
    it('应该正确解析 WSL 版本信息', () => {
      const mockOutput = `
WSL version: 2.0.14.0
Kernel version: 5.15.133.1-1
WSLg version: 1.0.59
MSRDC version: 1.2.4677
Windows version: 10.0.22631.3737
      `;

      const result = parseWSLVersion(mockOutput);
      expect(result).toEqual({
        version: '2.0.14.0',
        kernel: '5.15.133.1',
      });
    });

    it('应该在无版本信息时返回 null', () => {
      const result = parseWSLVersion('Command not recognized');
      expect(result).toBeNull();
    });

    it('应该处理缺少 kernel 版本的情况', () => {
      const mockOutput = 'WSL version: 1.0.0';
      const result = parseWSLVersion(mockOutput);
      expect(result).toEqual({
        version: '1.0.0',
        kernel: 'unknown',
      });
    });
  });

  describe('parseVTStatus', () => {
    it('应该检测虚拟化已启用', () => {
      const output = 'Virtualization Enabled In Firmware: Yes';
      expect(parseVTStatus(output)).toBe(true);
    });

    it('应该检测虚拟化未启用（英文）', () => {
      const output = 'Virtualization Enabled In Firmware: No';
      expect(parseVTStatus(output)).toBe(false);
    });

    it('应该检测虚拟化未启用（中文）', () => {
      const output = '固件中已启用虚拟化: 否';
      expect(parseVTStatus(output)).toBe(false);
    });

    it('应该在没有明确信息时假设已启用', () => {
      const output = 'Some other system info';
      expect(parseVTStatus(output)).toBe(true);
    });
  });
});
