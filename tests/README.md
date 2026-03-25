# 测试方案

本项目使用双轨测试策略：

1. **主进程单元测试** - Vitest（Node.js 环境）
2. **渲染进程集成测试** - Playwright（Electron E2E）

---

## 1. 依赖安装命令

```bash
# 安装主进程测试依赖
npm install -D vitest @vitest/coverage-v8

# 安装渲染进程测试依赖
npm install -D @playwright/test

# 安装 Playwright 浏览器二进制文件
npx playwright install chromium

# 或者使用 npm 脚本
npm run test:install
```

### 依赖说明

| 包名 | 用途 |
|------|------|
| `vitest` | 主进程单元测试框架 |
| `@vitest/coverage-v8` | 代码覆盖率报告 |
| `@playwright/test` | Electron E2E 测试框架 |

---

## 2. npm scripts

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

### 使用示例

### 前置要求

**⚠️ 渲染进程测试使用打包后的应用，必须先运行 package！**

```bash
# 打包应用（必须）
npm run package

# 然后运行测试
npm run test:renderer
```

### 运行测试

```bash
# 运行所有测试
npm test

# 仅运行主进程单元测试（无需构建）
npm run test:main

# 主进程测试监视模式（开发时使用）
npm run test:main:watch

# 生成覆盖率报告
npm run test:main:coverage

# 仅运行渲染进程集成测试（需先构建）
npm run test:renderer

# Playwright UI 模式（调试用）
npm run test:renderer:ui

# Playwright 调试模式
npm run test:renderer:debug
```

---

## 3. 测试结构

```
tests/
├── main/                    # 主进程单元测试
│   ├── util.test.ts        # 工具函数测试
│   ├── ipc-util.test.ts    # IPC 工具测试
│   └── cmd/
│       └── wsl.test.ts     # WSL 检测测试
├── renderer/                # 渲染进程集成测试
│   ├── smoke.spec.ts       # 冒烟测试（最简启动测试）
│   ├── basic.spec.ts       # 基础功能测试
│   └── README.md           # 渲染测试指南
├── README.md               # 本文件
├── global-setup.ts         # Playwright 全局设置
├── vitest.config.ts        # Vitest 配置（项目根目录）
└── playwright.config.ts    # Playwright 配置（项目根目录）
```

---

## 4. 编写测试

### 主进程单元测试

参考 `tests/main/` 中的示例：

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('功能模块', () => {
  it('应该正确执行某操作', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = yourFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### 渲染进程集成测试

参考 `tests/renderer/` 中的示例：

```typescript
import { test, expect, _electron as electron } from '@playwright/test';

let electronApp: Awaited<ReturnType<typeof electron.launch>>;

test.beforeEach(async () => {
  electronApp = await electron.launch({
    args: ['.webpack/main'],
  });
});

test.afterEach(async () => {
  await electronApp.close();
});

test('页面测试', async () => {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('networkidle');
  
  // 你的测试逻辑
  await expect(window.locator('body')).toBeVisible();
});
```

---

## 5. 扩展测试

### 添加新的主进程测试

1. 在 `tests/main/` 创建 `.test.ts` 文件
2. 遵循现有测试模式
3. 使用 `vi.mock()` 模拟外部依赖

### 添加新的渲染进程测试

1. 在 `tests/renderer/` 创建 `.spec.ts` 文件
2. 参考现有页面的测试模板
3. 在页面组件中添加 `data-testid` 属性便于测试定位

### 添加覆盖率阈值

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

---

## 6. CI/CD 集成

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

---

## 7. 故障排除

### 主进程测试

- **模块未找到**: 检查 `vitest.config.ts` 中的别名配置
- **Electron API 报错**: 使用 `vi.mock('electron')` 模拟

### 渲染进程测试

- **应用无法启动**: 确保先运行 `npm run package` 或 `npm run start` 生成 `.webpack/` 目录
  ```
  ❌ 错误: 未找到构建产物 .webpack/main/
  请先运行以下命令构建应用:
  
    npm run package    # 生产构建
    npm run start      # 开发构建（保持运行）
  ```
- **窗口立即关闭**: 
  1. 检查 `.webpack/main/index.js` 是否存在
  2. 尝试运行 `npx electron .webpack/main/index.js` 手动启动看报错
  3. 检查 Node 版本兼容性
- **"共建计划"弹窗阻塞测试**: 在测试前设置 localStorage 跳过欢迎弹窗
  ```typescript
  await window.evaluate(() => {
    localStorage.setItem('ai_learning_assistant_welcome_shown', 'true');
  });
  await window.reload();
  ```
- **选择器找不到元素**: 检查元素是否已加载，使用 `waitForTimeout` 或 `waitForSelector`
- **截图/视频占用空间**: 已配置为仅在失败时保留，定期清理 `test-results/`
