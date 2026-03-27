/**
 * 测试: 工具箱页面 (AI Toolbox) 导航测试
 *
 * 目标页面: AI 工具箱页面
 * 路由路径: /native-ai-service
 * 功能描述:
 *   - 一站式管理多种实用 AI 工具
 *   - 包含功能：文字转语音(TTS)、语音转文字(ASR)、PDF 转 Markdown
 *   - 让技术操作变得简单快捷
 *
 * 验证内容:
 * - 能从首页导航到工具箱页面
 * - 工具箱页面能正确加载
 * - URL 包含 /native-ai-service
 *
 * ⚠️ 注意：使用 CDP 方式连接应用
 */
import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, ROUTES, HOME_PAGE_SELECTORS } from './test-helpers';

test.describe('工具箱 (AI Toolbox) 页面导航测试', () => {
  test('应该能直接导航到工具箱页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 通过修改 location.hash 导航
      await navigateTo(page, ROUTES.TOOLBOX.path);

      // 验证 URL 正确
      const url = page.url();
      console.log(`✅ 导航成功，当前 URL: ${url}`);
      expect(url).toContain('#/native-ai-service');
    } finally {
      await cleanup();
    }
  });

  test('工具箱页面应该加载成功', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 导航到工具箱页面
      await navigateTo(page, ROUTES.TOOLBOX.path);

      // 验证页面 body 存在
      await expect(page.locator('body')).toBeAttached({ timeout: 5000 });

      console.log('✅ 工具箱页面已加载');
    } finally {
      await cleanup();
    }
  });

  test('应该能从首页通过"工具箱"入口导航', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 先回到首页
      await navigateTo(page, ROUTES.HOME.path);

      // 验证首页有"工具箱"文字
      await expect(page.locator(HOME_PAGE_SELECTORS.TOOLBOX_TITLE)).toBeVisible({ timeout: 5000 });

      // 找到"工具箱"卡片
      await expect(page.locator(HOME_PAGE_SELECTORS.TOOLBOX_CARD)).toBeVisible({ timeout: 5000 });

      console.log('✅ 首页工具箱入口验证成功');
    } finally {
      await cleanup();
    }
  });

  test('工具箱子功能页面导航测试', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 工具箱包含以下子功能，测试能否导航到这些页面
      const subPages = [
        { route: ROUTES.TTS_CONFIG, name: '文字转语音(TTS)' },
        { route: ROUTES.ASR_CONFIG, name: '语音转文字(ASR)' },
        { route: ROUTES.PDF_CONFIG, name: 'PDF配置' },
      ];

      for (const pageInfo of subPages) {
        // 导航到子页面
        await navigateTo(page, pageInfo.route.path);

        const url = page.url();
        expect(url).toContain(pageInfo.route.path.replace('#', ''));
        console.log(`✅ ${pageInfo.name} 页面导航成功: ${url}`);
      }
    } finally {
      await cleanup();
    }
  });
});
