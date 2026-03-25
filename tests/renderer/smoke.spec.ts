/**
 * 冒烟测试 - 验证应用能启动和导航
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';

let electronApp: Awaited<ReturnType<typeof electron.launch>> | null = null;

const appEntryPath = join(__dirname, '../../out/AI-Learning-Assistant-Launcher-win32-x64/resources/app.asar/.webpack/main/index.js');

test.beforeAll(async () => {
  electronApp = await electron.launch({
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

  const window = await electronApp.firstWindow({ timeout: 20000 });
  await window.waitForLoadState('domcontentloaded', { timeout: 20000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close().catch(() => {});
  }
});

test.describe('冒烟测试', () => {
  test('应用应该能正常启动和显示窗口', async () => {
    const window = await electronApp!.firstWindow();
    
    const body = window.locator('body');
    await expect(body).toBeAttached({ timeout: 10000 });
    
    const title = await window.title();
    console.log(`✅ 应用启动成功，窗口标题: "${title}"`);
  });

  test('应该能导航到 AI Service 页面', async () => {
    const window = await electronApp!.firstWindow();
    
    await window.evaluate(() => {
      window.location.hash = '#/ai-service';
    });
    
    await window.waitForTimeout(300);
    
    const url = window.url();
    console.log(`✅ 导航成功: ${url}`);
    expect(url).toContain('#/ai-service');
  });
});
