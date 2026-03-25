import { defineConfig } from '@playwright/test';
import { join } from 'path';

// Electron 可执行文件路径 (可选，Playwright 会自动查找 node_modules 中的 electron)
// const electronExecutable = join(__dirname, 'node_modules/electron/dist/electron.exe');
// 应用入口路径（asar 归档中的主进程入口）
const appEntryPath = join(__dirname, 'out/AI-Learning-Assistant-Launcher-win32-x64/resources/app.asar/.webpack/main/index.js');

export default defineConfig({
  testDir: './tests/renderer',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'electron',
      use: {
        // executablePath: electronExecutable,  // 让 Playwright 自动查找 Electron
        launchOptions: {
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
          timeout: 20000,
        },
      },
    },
  ],

  timeout: 60 * 1000,
  expect: {
    timeout: 15 * 1000,
  },

  globalSetup: './tests/global-setup.ts',
});
