import { defineConfig } from '@playwright/test';
import { join } from 'path';

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
        launchOptions: {
          args: [
            // 使用 asar 归档中的入口
            join(__dirname, 'out/AI-Learning-Assistant-Launcher-win32-x64/resources/app.asar/.webpack/main/index.js'),
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
