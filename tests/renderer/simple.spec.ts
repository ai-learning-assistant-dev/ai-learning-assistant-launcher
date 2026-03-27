/**
 * 极简测试 - 验证应用能启动
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';

// Electron 可执行文件路径
const electronExecutable = join(__dirname, '../../node_modules/electron/dist/electron.exe');
// 应用入口路径
const appEntryPath = join(__dirname, '../../out/AI-Learning-Assistant-Launcher-win32-x64/resources/app.asar/.webpack/main/index.js');

test('应用应该能正常启动', async () => {
  const electronApp = await electron.launch({
    // executablePath: electronExecutable,  // 让 Playwright 自动查找
    args: [
      appEntryPath,
      '--test-mode',
      '--disable-gpu',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  try {
    const window = await electronApp.firstWindow({ timeout: 20000 });
    await window.waitForLoadState('domcontentloaded', { timeout: 20000 });
    
    const body = window.locator('body');
    await expect(body).toBeAttached({ timeout: 10000 });
    
    const url = window.url();
    console.log(`✅ 应用启动成功: ${url}`);
    
  } finally {
    await electronApp.close().catch(() => {});
  }
});
