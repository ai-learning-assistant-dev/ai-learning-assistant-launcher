/**
 * 导航测试辅助工具函数
 * 
 * 这个文件包含了一些常用的辅助函数，可以在编写测试时复用
 */

import { Page, chromium } from '@playwright/test';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

/**
 * 应用可执行文件路径
 */
export const APP_EXE_PATH = join(
  __dirname,
  '../../../out/AI-Learning-Assistant-Launcher-win32-x64/AI-Learning-Assistant-Launcher.exe'
);

/**
 * 应用路由配置
 * 对应 src/renderer/app.tsx 中的路由定义
 */
export const ROUTES = {
  // 首页
  HOME: { path: '#/hello', name: '首页', description: '应用主页面' },
  
  // 阅读器
  READER: { path: '#/obsidian-app', name: '阅读器', description: 'Obsidian 阅读器管理' },
  
  // 工具箱
  TOOLBOX: { path: '#/native-ai-service', name: '工具箱', description: 'AI 工具箱(TTS/ASR/PDF)' },
  
  // 大模型
  LLM_SERVICE: { path: '#/lm-service', name: '大模型服务', description: 'LM Studio 管理' },
  LLM_CONFIG: { path: '#/llm-api-config', name: 'LLM API配置', description: 'API 密钥配置' },
  
  // AI 服务（容器版）
  AI_SERVICE: { path: '#/ai-service', name: 'AI服务', description: '容器版 AI 服务' },
  
  // 工具箱子页面
  TTS_CONFIG: { path: '#/TTS-config', name: 'TTS配置', description: '文字转语音' },
  ASR_CONFIG: { path: '#/ASR-config', name: 'ASR配置', description: '语音转文字' },
  PDF_CONFIG: { path: '#/PDF-config', name: 'PDF配置', description: 'PDF 转换配置' },
  PDF_CONVERT: { path: '#/pdf-convert', name: 'PDF转换', description: 'PDF 转 Markdown' },
  VOICE_RTC_CONFIG: { path: '#/VOICE-RTC-config', name: '语音RTC配置', description: '实时语音配置' },
  
  // 工作区
  WORKSPACE_MANAGE: { path: '#/workspace-manage/default', name: '工作区管理', description: '工作区管理' },
  
  // 插件
  OBSIDIAN_PLUGIN: { path: '#/obsidian-plugin/default', name: 'Obsidian插件', description: '插件管理' },
  
  // 其他
  JOINT_BUILD: { path: '#/joint-build', name: '共建计划', description: 'P2P共建计划' },
  P2P_TEST: { path: '#/p2p-test', name: 'P2P测试', description: 'P2P测试页面' },
  EXAMPLE: { path: '#/example', name: '示例页面', description: '示例/模板页面' },
} as const;

/**
 * 启动应用并返回 page 对象
 * @returns {Promise<{ proc: ChildProcess; page: Page; cleanup: () => Promise<void> }>}
 * 
 * 示例用法:
 * ```typescript
 * const { page, cleanup } = await launchApp();
 * try {
 *   // 你的测试代码
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export async function launchApp(): Promise<{
  proc: ChildProcess;
  page: Page;
  cleanup: () => Promise<void>;
}> {
  // 启动应用
  const proc = spawn(APP_EXE_PATH, ['--test-mode', '--remote-debugging-port=9222'], {
    env: { ...process.env, NODE_ENV: 'production' },
  });

  // 等待应用启动
  await new Promise((resolve) => setTimeout(resolve, 3000));

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

/**
 * 导航到指定路由
 * @param page - Playwright Page 对象
 * @param route - 路由路径（如 '#/hello'）
 * @param waitTime - 等待时间（毫秒）
 */
export async function navigateTo(
  page: Page,
  route: string,
  waitTime: number = 800
): Promise<void> {
  await page.evaluate((r) => {
    window.location.hash = r;
  }, route);
  await page.waitForTimeout(waitTime);
}

/**
 * 获取当前 URL
 * @param page - Playwright Page 对象
 */
export async function getCurrentUrl(page: Page): Promise<string> {
  return page.url();
}

/**
 * 验证当前页面 URL 是否包含指定路径
 * @param page - Playwright Page 对象
 * @param expectedPath - 期望的路径
 */
export async function verifyUrlContains(
  page: Page,
  expectedPath: string
): Promise<boolean> {
  const url = await getCurrentUrl(page);
  return url.includes(expectedPath.replace('#', ''));
}

/**
 * 首页功能卡片选择器
 */
export const HOME_PAGE_SELECTORS = {
  // 功能卡片
  READER_CARD: '.feature-card:has-text("阅读器")',
  TOOLBOX_CARD: '.feature-card:has-text("工具箱")',
  LLM_CARD: '.feature-card:has-text("大模型")',
  TRAINING_CARD: '.feature-card:has-text("学科培训")',

  // 功能标题
  READER_TITLE: '.feature-title:has-text("阅读器")',
  TOOLBOX_TITLE: '.feature-title:has-text("工具箱")',
  LLM_TITLE: '.feature-title:has-text("大模型")',
  TRAINING_TITLE: '.feature-title:has-text("学科培训")',

  // 按钮
  START_BUTTON: 'button:has-text("开始")',
  INSTALL_BUTTON: 'button:has-text("安装")',
  UPDATE_BUTTON: 'button:has-text("更新课程")',
  LOG_BUTTON: 'button:has-text("日志")',
  UNINSTALL_BUTTON: 'button:has-text("卸载")',

  // 其他
  CAROUSEL: '.carousel-container',
  FOOTER: '.hello-footer',
};

/**
 * 打印测试分隔线
 * @param title - 标题
 */
export function printSeparator(title: string): void {
  console.log('\n' + '='.repeat(50));
  console.log(`  ${title}`);
  console.log('='.repeat(50));
}

/**
 * 打印导航结果
 * @param routeName - 路由名称
 * @param url - 当前 URL
 * @param success - 是否成功
 */
export function printNavigationResult(
  routeName: string,
  url: string,
  success: boolean
): void {
  const status = success ? '✅' : '❌';
  console.log(`${status} ${routeName}: ${url}`);
}

/**
 * 示例：使用辅助函数的测试模板
 *
 * ```typescript
 * import { test, expect } from '@playwright/test';
 * import { launchApp, navigateTo, ROUTES } from './test-helpers';
 *
 * test('示例测试', async () => {
 *   const { page, cleanup } = await launchApp();
 *   try {
 *     // 导航到工具箱
 *     await navigateTo(page, ROUTES.TOOLBOX.path);
 *
 *     // 验证 URL
 *     const url = page.url();
 *     expect(url).toContain('#/native-ai-service');
 *   } finally {
 *     await cleanup();
 *   }
 * });
 * ```
 */
