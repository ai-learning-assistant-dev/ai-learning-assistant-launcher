## 测试的办法和例子

**单元测试主进程** - Vitest（Running on Node.js 环境）

> Vitest（类似Jest）.

**集成测试渲染进程**- Playwright（Electron E2E）

### 测试工具与其依赖

```bash
# Vitest单元测试工具 和 覆盖率工具
npm install -D vitest @vitest/coverage-v8

# 用户UI交互的集成测试工具playwright
npm install -D @playwright/test

# 安装 Playwright 浏览器二进制文件
npx playwright install chromium
```

## 使用示例

### 执行UI E2E测试

```bash
# 打包应用（必须）⚠️ 渲染进程测试使用打包后的应用
npm run package

# 只执行UI测试
npm run test:renderer
```

### 执行主进程单元测试-主要面向后端模块

``` bash
# 仅运行主进程单元测试（无需构建）
npm run test:main

# 主进程测试监视模式（开发时使用）,这会持续执行单元测试保持逻辑回归
npm run test:main:watch

# 生成覆盖率报告
npm run test:main:coverage
```

### 运行所有测试

```bash
# 运行所有测试
npm test
```

### 测试相关的命令一览

```json
{
  "test": "npm run test:main && npm run test:renderer",
  "test:main": "vitest run",
  "test:main:watch": "vitest",
  "test:main:coverage": "vitest run --coverage",
  "test:renderer": "playwright test",
  "test:renderer:ui": "playwright test --ui",
  "test:renderer:debug": "playwright test --debug",
  "test:install": "playwright install chromium"
}
```



## 和测试有关的配置文件



### 覆盖率阈值

在 `vitest.config.ts` 中添加：

```typescript
coverage: {
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 80,
    statements: 80,
  },
}
```

### 测试代码的组织

```
tests/
├── main/                   # 主进程单元测试（真实导入源代码）
│   ├── exec-util.test.ts   # src/main/exec/util.ts 平台检测
│   └── README.md           # 主进程测试指南
├── renderer/               # 渲染进程集成测试
│   ├── smoke.spec.ts       # 冒烟测试，只测试成功启动
│   └── README.md           # 渲染测试指南
├── README.md               # 本文件
├── global-setup.ts         # Playwright 全局设置
├── vitest.config.ts        # Vitest 配置（项目根目录）
└── playwright.config.ts    # Playwright 配置（项目根目录）
```

---

#### 添加新主进程测试

在 `tests/main/` 创建 `.test.ts` 文件

#### 添加新的渲染进程测试

在 `tests/renderer/` 创建 `.spec.ts` 文件

##### 相关命令-使用Playwright编写测试

``` bash
# Playwright的UI模式，可视化的编写UI测试脚本
npm run test:renderer:ui

# Playwright和渲染进程同时启动，并且开启就是断点状态，相当于开启WebDevtools配合编写脚本
npm run test:renderer:debug
```



## Help Q&A

1. 主进程测试**模块未找到**: 检查 `vitest.config.ts` 中的别名配置

2. 渲染进程测试**窗口立即关闭**:
   1. 检查 `.webpack/main/index.js` 是否存在
   2. 尝试运行 `npx electron .webpack/main/index.js` 手动启动看报错
3. **"共建计划"弹窗阻塞退出进程测试**: 在测试前设置 localStorage 跳过欢迎弹窗，这是因为如果一个进程实例不被关闭就无法进行下一个测试用例

```typescript
await window.evaluate(() => {
  localStorage.setItem('ai_learning_assistant_welcome_shown', 'true');
});
await window.reload();
```

4. **环境变量**：测试和环境变量 `process.env`有关，单个测试用例修改后使用 `afterEach` 中恢复原本值来进行下一个测试用例。

5. **缓存机制和测试用例的情形**：使用 `import`的时候可能会发生缓存的现象，考虑下面模块的形式：

```typescript
const createModuleWithConstant = (initialPlatform: string) => {
    // 这相当于模块中的：const platform = os.platform();
    const platform = initialPlatform;

    return {
        getPlatform: () => platform,
        isWindows: () => platform === 'win32',
        isMac: () => platform === 'darwin',
        isLinux: () => platform === 'linux',
    };
}
```

这种类似工厂函数的引用每次都可以通过传递新的参数得到新的对象，但是某些时候我们会遇到下面的情况：

```bash
export createModuleWithConstant("windows")
```

这种时候我们得到的就是值不会改变的对象，反复的`import` 得到的也是同一个对象，所以可以通过 `vi.resetModules()`刷新`import`的结果。

## 更多测试常见情形

### 测试纯函数

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

### 测试依赖 electron 的模块

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

### 测试依赖 Node.js 内置模块的函数

使用 `vi.mock()` 模拟内置模块：

```typescript
import { vi } from 'vitest';
import * as os from 'os';

vi.mock('os', () => ({
  platform: vi.fn().mockReturnValue('win32'),
}));

// 测试代码
```

## CI/CD 集成

> 没试过这个。

GitHub Actions 示例：

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run test:install
      - run: npm test
```

