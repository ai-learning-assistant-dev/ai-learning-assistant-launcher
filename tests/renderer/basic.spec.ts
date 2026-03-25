/**
 * 基础功能测试 - 每个测试独立启动
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';

const appEntryPath = join(__dirname, '../../out/AI-Learning-Assistant-Launcher-win32-x64/resources/app.asar/.webpack/main/index.js');

async function launchApp() {
  return await electron.launch({
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
}

async function closeApp(app: Awaited<ReturnType<typeof electron.launch>>) {
  await app.close().catch(() => {});
}

test.describe('基础功能', () => {
  test('应该显示主页面', async () => {
    const app = await launchApp();
    
    try {
      const window = await app.firstWindow({ timeout: 20000 });
      await window.waitForLoadState('domcontentloaded', { timeout: 20000 });
      
      const body = window.locator('body');
      await expect(body).toBeAttached({ timeout: 10000 });
      
      const url = window.url();
      console.log(`✅ 当前页面: ${url}`);
    } finally {
      await closeApp(app);
    }
  });

  test('应该能导航到 AI Service 页面', async () => {
    const app = await launchApp();
    
    try {
      const window = await app.firstWindow({ timeout: 20000 });
      await window.waitForLoadState('domcontentloaded', { timeout: 20000 });
      
      await window.evaluate(() => {
        window.location.hash = '#/ai-service';
      });
      await window.waitForTimeout(300);
      
      const url = window.url();
      console.log(`✅ 导航成功: ${url}`);
      expect(url).toContain('#/ai-service');
    } finally {
      await closeApp(app);
    }
  });
});
