/* 
  预期使用方法：npm test -- src/main/exec/__tests__/exec.spec.ts
*/

jest.mock('electron', () => ({
  app: {
    isPackaged: false, 
    getPath: jest.fn().mockReturnValue('/mocked/exe/path'),
    getAppPath: jest.fn().mockReturnValue('/mocked/app/path'),
  },
}));

const { Exec } = require('../index');

describe('测试 Exec类 应该可以成功初始化', () => {
  it('should create an instance', () => {
    const exec = new Exec();
    expect(exec).toBeInstanceOf(Exec);
    expect(typeof exec.exec).toBe('function');
  });
});