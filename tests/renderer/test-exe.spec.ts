/**
 * 测试使用应用程序的可执行文件启动
 */
import { test, expect } from '@playwright/test';
import { join } from 'path';
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';

test('测试使用应用程序 EXE 启动', async () => {
  const exePath = join(__dirname, '../../out/AI-Learning-Assistant-Launcher-win32-x64/AI-Learning-Assistant-Launcher.exe');
  
  console.log('启动应用程序:', exePath);
  
  // 启动应用程序
  const proc = spawn(exePath, ['--test-mode', '--remote-debugging-port=9222'], {
    env: { ...process.env, NODE_ENV: 'production' },
  });
  
  // 等待应用程序启动
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    // 使用 Chromium 连接到远程调试端口
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    
    console.log('页面 URL:', page.url());
    await expect(page.locator('body')).toBeAttached({ timeout: 5000 });
    
    await browser.close();
    console.log('✅ 测试通过！');
  } finally {
    proc.kill();
  }
});
