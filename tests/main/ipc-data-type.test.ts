/**
 * IPC 数据类型测试
 * 真实导入 src/main/ipc-data-type.ts 中的类型和类
 */
import { describe, it, expect } from 'vitest';
import { MESSAGE_TYPE, MessageData } from '../../src/main/ipc-data-type';

describe('ipc-data-type.ts', () => {
  describe('MESSAGE_TYPE 枚举', () => {
    it('应该包含所有消息类型', () => {
      expect(MESSAGE_TYPE.ERROR).toBe('error');
      expect(MESSAGE_TYPE.INFO).toBe('info');
      expect(MESSAGE_TYPE.WARNING).toBe('warning');
      expect(MESSAGE_TYPE.DATA).toBe('data');
      expect(MESSAGE_TYPE.PROGRESS).toBe('progress');
      expect(MESSAGE_TYPE.PROGRESS_ERROR).toBe('progress_error');
    });

    it('应该能通过值反向查找', () => {
      const values = Object.values(MESSAGE_TYPE);
      expect(values).toContain('error');
      expect(values).toContain('data');
      expect(values).toHaveLength(6);
    });
  });

  describe('MessageData 类', () => {
    it('应该正确创建消息对象', () => {
      const message = new MessageData('test-action', 'test-service', { foo: 'bar' });
      
      expect(message.action).toBe('test-action');
      expect(message.service).toBe('test-service');
      expect(message.data).toEqual({ foo: 'bar' });
    });

    it('应该正确序列化为字符串', () => {
      const message = new MessageData('action', 'service', { key: 'value' });
      const str = message.toString();
      
      expect(str).toBe('action,service,{"key":"value"}');
    });

    it('应该处理复杂数据类型', () => {
      const complexData = {
        array: [1, 2, 3],
        nested: { a: 1, b: 2 },
        null: null,
      };
      const message = new MessageData('complex', 'service', complexData);
      
      expect(message.data).toEqual(complexData);
      expect(message.toString()).toContain('complex');
      expect(message.toString()).toContain('service');
    });

    it('应该处理字符串数据', () => {
      const message = new MessageData('string-action', 'string-service', 'raw string');
      
      expect(message.data).toBe('raw string');
      expect(message.toString()).toBe('string-action,string-service,"raw string"');
    });
  });
});
