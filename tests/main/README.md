# 主进程单元测试

本目录包含 Vitest 编写的单元测试，**真实导入** `src/main/` 中的源代码。

## 测试文件说明

| 文件 | 测试目标 | 说明 |
|------|----------|------|
| `util.test.ts` | `src/main/util.ts` | `wait`, `onlyAlphaNumericLine`, `resolveHtmlPath` |
| `ipc-data-type.test.ts` | `src/main/ipc-data-type.ts` | `MESSAGE_TYPE` 枚举, `MessageData` 类 |
| `ipc-util.test.ts` | `src/main/ipc-util.ts` | `ipcHandle` 函数 (mock electron) |
| `exec-util.test.ts` | `src/main/exec/util.ts` | 占位测试（模块依赖 electron） |
| `cmd/wsl.test.ts` | `src/main/cmd/is-wsl-install.ts` | WSL 版本解析逻辑 |

## 运行测试

```bash
# 运行所有主进程测试
npm run test:main

# 运行单个测试文件
npx vitest run tests/main/util.test.ts

# 监视模式（开发时使用）
npm run test:main:watch

# 生成覆盖率报告
npm run test:main:coverage
```

## 编写新测试

### 1. 测试纯函数

对于不依赖 electron 的纯函数，直接导入测试：

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../src/main/my-module';

describe('myFunction', () => {
  it('应该正确执行', () => {
    expect(myFunction('input')).toBe('output');
  });
});
```

### 2. 测试依赖 electron 的模块

使用 `vi.mock()` 模拟 electron：

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/path') },
}));

import { myFunction } from '../../src/main/my-module';

describe('myFunction', () => {
  it('应该正确执行', () => {
    // 测试代码
  });
});
```

### 3. 测试依赖 Node.js 内置模块的函数

使用 `vi.mock()` 模拟内置模块：

```typescript
import { vi } from 'vitest';
import * as os from 'os';

vi.mock('os', () => ({
  platform: vi.fn().mockReturnValue('win32'),
}));

// 测试代码
```

## 注意事项

1. **Electron 依赖**：许多主进程模块依赖 `electron`，需要使用 `vi.mock()` 模拟
2. **模块缓存**：修改 mock 后可能需要使用 `vi.resetModules()` 重新导入
3. **异步测试**：对于 async 函数，使用 `async/await` 或返回 Promise
4. **环境变量**：可以在测试中修改 `process.env`，但记得在 `afterEach` 中恢复

## 扩展测试

要添加新的测试文件：

1. 在 `tests/main/` 目录下创建 `.test.ts` 文件
2. 从 `src/main/` 导入要测试的函数
3. 使用 `vi.mock()` 模拟必要的依赖
4. 编写测试用例

示例：

```typescript
// tests/main/my-feature.test.ts
import { describe, it, expect } from 'vitest';
import { myPureFunction } from '../../src/main/my-feature';

describe('myPureFunction', () => {
  it('应该正确处理输入', () => {
    expect(myPureFunction('input')).toBe('expected output');
  });
});
```
