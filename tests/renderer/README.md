# 渲染进程集成测试

本目录包含使用 Playwright 编写的 Electron 应用 E2E/集成测试。

## 测试结构

```
tests/renderer/
├── smoke.spec.ts           # 冒烟测试（最简启动测试）
├── basic.spec.ts           # 基础功能测试（导航等）
└── README.md               # 本文件
```

## 关键注意事项

### 欢迎弹窗处理

应用首次启动会显示"加入共建计划"弹窗（`WelcomeModal`），会阻塞测试。

**解决方案**：在 `beforeEach` 中预设置 localStorage:

```typescript
const window = await electronApp.firstWindow();
await window.evaluate(() => {
  localStorage.setItem('ai_learning_assistant_welcome_shown', 'true');
});
await window.reload(); // 刷新使设置生效
```

参考 `basic.spec.ts` 的实现。

## 编写新测试

### 1. 基础模板

```typescript
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';

let electronApp: Awaited<ReturnType<typeof electron.launch>>;

test.beforeEach(async () => {
  electronApp = await electron.launch({
    args: [
      join(__dirname, '../../.webpack/main/index.js'),
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  // 跳过欢迎弹窗
  const window = await electronApp.firstWindow();
  await window.evaluate(() => {
    localStorage.setItem('ai_learning_assistant_welcome_shown', 'true');
  });
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await electronApp.close({ force: true });
});

test.describe('页面名称', () => {
  test('测试描述', async () => {
    const window = await electronApp.firstWindow();
    // 你的测试逻辑
  });
});
```

### 2. 常用操作

```typescript
// 导航到特定页面
await window.evaluate(() => {
  window.location.hash = '#/your-page';
});

// 等待元素
await window.locator('.your-selector').waitFor();

// 点击元素
await window.click('.your-button');

// 输入文本
await window.fill('.your-input', 'text');

// 获取元素文本
const text = await window.locator('.your-element').textContent();

// 截图
await window.screenshot({ path: 'screenshot.png' });

// 执行 IPC 调用
const result = await window.evaluate(async () => {
  // 渲染进程代码
  return await window.electronAPI.yourMethod();
});
```

### 3. 调试技巧

```typescript
// 启用可见窗口进行调试
electronApp = await electron.launch({
  args: [join(__dirname, '../../.webpack/main/index.js')],
  headless: false,  // 显示窗口
  slowMo: 100,      // 慢动作执行
});

// 监听控制台日志
window.on('console', (msg) => console.log(msg.text()));

// 监听页面错误
window.on('pageerror', (error) => console.error(error));
```

## 最佳实践

1. **处理欢迎弹窗**：始终在 `beforeEach` 中设置 localStorage 跳过弹窗
2. **使用 force: true 关闭**：防止应用关闭时卡住
3. **缩短超时**：配置合理的超时时间，避免长时间等待
4. **串行执行**：Electron 测试建议 `workers: 1` 避免冲突
