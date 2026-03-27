# 渲染进程集成测试

目录包含使用 Playwright 编写的 Electron 应用 E2E/集成测试。

## 目录结构

> 如果你要编写后端的工具函数的测试用例，应该在上层目录的`main`

```
tests/renderer/
├── smoke.spec.ts           # 冒烟测试（最简启动测试）
├── basic.spec.ts           # 基础功能测试（导航等）
└── README.md               # 本文件
```

## 常见的要处理的细节

> 虽然模拟的使用户的行为，然而仍然不免要考虑到启动器自己的许多弹窗等等的情况要处理，算是编写测试时的Dirty Work了，相当的Hack。

1. **处理欢迎弹窗**：始终在 `beforeEach` 中设置 localStorage 跳过弹窗
2. **使用 force: true 关闭**：防止应用关闭时卡住
3. **缩短超时**：配置合理的超时时间，避免长时间等待
4. **串行执行**：Electron 测试建议 `workers: 1` 避免冲突

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

# 开始编写新测试

## 基础模板

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

## 常用操作

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

## 调试技巧

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

## 导航到各个页面的脚本例子

navigation目录包含了一系列基础的 Playwright 测试脚本，用于验证从首页（hello）进入各个子功能页面的导航是否正常。

### ⚠️ 重要说明

由于 Playwright 1.58.2 与 Electron 36.5.0 存在兼容性问题，测试使用了 **CDP (Chrome DevTools Protocol)** 方式连接应用，而不是直接使用 `electron.launch`。

### 📁 测试文件列表

| 序号 | 脚本文件                       | 测试目标 | 路由路径             | 功能描述                         |
| :--: | ------------------------------ | -------- | -------------------- | -------------------------------- |
|  00  | `00-all-navigation.spec.ts`    | 所有页面 | 全部                 | 综合导航测试，按顺序测试所有页面 |
|  01  | `01-hello-home.spec.ts`        | 首页     | `/hello`             | 应用启动、四个功能入口存在性     |
|  02  | `02-reader-obsidian.spec.ts`   | 阅读器   | `/obsidian-app`      | Obsidian 管理页面导航            |
|  03  | `03-toolbox-native-ai.spec.ts` | 工具箱   | `/native-ai-service` | AI 工具箱及子页面(TTS/ASR/PDF)   |
|  04  | `04-llm-service.spec.ts`       | 大模型   | `/lm-service`        | LM Studio 管理及 API 配置        |
|  05  | `05-subject-training.spec.ts`  | 学科培训 | 首页内               | 学科培训卡片、按钮状态验证       |

### 🚀 运行测试

```bash
# 运行所有导航测试
npx playwright test tests/renderer/navigation/

# 运行单个测试文件
npx playwright test tests/renderer/navigation/01-hello-home.spec.ts

# 带 UI 界面运行
npx playwright test tests/renderer/navigation/ --ui

# 调试模式
npx playwright test tests/renderer/navigation/02-reader-obsidian.spec.ts --debug

# 只运行综合测试
npx playwright test tests/renderer/navigation/00-all-navigation.spec.ts
```

### 📝 参考模板

#### 基础模板（用于创建新测试）

```typescript
import { test, expect, chromium } from '@playwright/test';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

const exePath = join(__dirname, '../../../out/AI-Learning-Assistant-Launcher-win32-x64/AI-Learning-Assistant-Launcher.exe');

async function launchApp(): Promise<{ proc: ChildProcess; page: any; cleanup: () => Promise<void> }> {
  // 启动应用
  const proc = spawn(exePath, ['--test-mode', '--remote-debugging-port=9222'], {
    env: { ...process.env, NODE_ENV: 'production' },
  });
  
  // 等待应用启动
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 连接 CDP
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  
  const cleanup = async () => {
    await browser.close();
    proc.kill();
  };
  
  return { proc, page, cleanup };
}

test('测试示例', async () => {
  const { page, cleanup } = await launchApp();
  
  try {
    // 你的测试代码
    await expect(page.locator('body')).toBeAttached();
  } finally {
    await cleanup();
  }
});
```

### 🗺️ 路由对照表

根据 `src/renderer/app.tsx` 中的路由定义：

| 路由                 | 页面                     | 说明                |
| -------------------- | ------------------------ | ------------------- |
| `/`                  | Hello (首页)             | 默认首页            |
| `/hello`             | Hello (首页)             | 首页                |
| `/obsidian-app`      | ObsidianApp (阅读器)     | Obsidian 阅读器管理 |
| `/native-ai-service` | NativeAiService (工具箱) | AI 工具箱           |
| `/lm-service`        | LMService (大模型)       | LM Studio 管理      |
| `/ai-service`        | AiService (AI服务)       | 容器版 AI 服务      |
| `/TTS-config`        | TTSConfig                | 文字转语音配置      |
| `/ASR-config`        | ASRConfig                | 语音转文字配置      |
| `/PDF-config`        | PdfConfig                | PDF 配置            |
| `/pdf-convert`       | PdfConvert               | PDF 转换            |
| `/llm-api-config`    | LLMConfig                | LLM API 配置        |

### 🛠️ 辅助工具

`test-helpers.ts` 提供了可复用的辅助函数：

- `ROUTES` - 所有路由常量
- `launchApp()` - 启动应用
- `navigateTo()` - 导航到指定路由
- `HOME_PAGE_SELECTORS` - 首页选择器
