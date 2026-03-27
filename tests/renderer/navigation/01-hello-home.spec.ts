/**
 * 测试: 首页 (Hello Page) 基础加载测试
 *
 * 目标页面: 首页 /hello
 * 功能描述: 这是应用的首页，展示四个主要功能入口：阅读器、工具箱、大模型、学科培训
 *
 * 验证内容:
 * - 应用能正常启动
 * - 首页能正确加载
 * - 页面包含四个主要功能卡片
 *
 * ⚠️ 注意：使用 CDP 方式连接应用
 */
import { test, expect } from '@playwright/test';
import { launchApp, HOME_PAGE_SELECTORS } from './test-helpers';

test.describe('首页 (Hello Page) 基础测试', () => {
  test('应用应该能正常启动并显示窗口', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 验证 body 元素存在
      await expect(page.locator('body')).toBeAttached({ timeout: 10000 });

      // 获取并打印窗口标题
      const title = await page.title();
      console.log(`✅ 应用启动成功，页面标题: "${title}"`);
    } finally {
      await cleanup();
    }
  });

  test('首页应该包含四个主要功能入口', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 验证页面包含四个功能标题（使用 .feature-title 类选择器精确匹配）
      await expect(page.locator(HOME_PAGE_SELECTORS.READER_TITLE)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(HOME_PAGE_SELECTORS.TOOLBOX_TITLE)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(HOME_PAGE_SELECTORS.LLM_TITLE)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(HOME_PAGE_SELECTORS.TRAINING_TITLE)).toBeVisible({ timeout: 5000 });

      console.log('✅ 首页四个功能入口均已找到：阅读器、工具箱、大模型、学科培训');
    } finally {
      await cleanup();
    }
  });

  test('首页 URL 应该正确', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 等待页面加载完成
      await page.waitForTimeout(500);

      const url = page.url();
      console.log(`✅ 当前页面 URL: ${url}`);

      // 首页可能是 / 或 /hello 或 /#/hello
      expect(url).toMatch(/\/(hello|index.html)?(#\/)?$/);
    } finally {
      await cleanup();
    }
  });
});
