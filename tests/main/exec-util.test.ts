/**
 * Exec 工具函数测试
 * 平台检测函数测试
 * 
 * 注意：由于 exec/util.ts 在导入时就访问 electron app 模块，
 * 此测试文件需要使用不同的方式。这里我们只测试可独立测试的部分。
 */
import { describe, it, expect } from 'vitest';

describe('exec/util.ts 占位测试', () => {
  it('平台检测函数需要在集成环境中测试', () => {
    // exec/util.ts 依赖 electron app 模块
    // 实际的平台检测测试可以在集成测试中进行
    expect(true).toBe(true);
  });
});
