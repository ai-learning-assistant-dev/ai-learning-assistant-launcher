/**
 * 测试: 大模型页面 (LLM Service) 导航测试
 *
 * 目标页面: LM Studio 大模型管理页面
 * 路由路径: /lm-service
 * 功能描述:
 *   - 统一管理本地与在线 AI 模型的 API
 *   - 为 Obsidian Copilot 等应用设置密钥
 *   - 省去繁琐的配置步骤
 *
 * 验证内容:
 * - 能从首页导航到大模型页面
 * - 大模型页面能正确加载
 * - URL 包含 /lm-service
 *
 * ⚠️ 注意：使用 CDP 方式连接应用
 */
import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, ROUTES, HOME_PAGE_SELECTORS } from './test-helpers';

test.describe('大模型 (LLM Service) 页面导航测试', () => {
  test('应该能直接导航到大模型页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 通过修改 location.hash 导航
      await navigateTo(page, ROUTES.LLM_SERVICE.path);

      // 验证 URL 正确
      const url = page.url();
      console.log(`✅ 导航成功，当前 URL: ${url}`);
      expect(url).toContain('#/lm-service');
    } finally {
      await cleanup();
    }
  });

  test('大模型页面应该加载成功', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 导航到大模型页面
      await navigateTo(page, ROUTES.LLM_SERVICE.path);

      // 验证页面 body 存在
      await expect(page.locator('body')).toBeAttached({ timeout: 5000 });

      console.log('✅ 大模型页面已加载');
    } finally {
      await cleanup();
    }
  });

  test('应该能从首页通过"大模型"入口导航', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 先回到首页
      await navigateTo(page, ROUTES.HOME.path);

      // 验证首页有"大模型"标题（使用 .feature-title 类选择器避免匹配到欢迎弹窗的描述）
      await expect(page.locator(HOME_PAGE_SELECTORS.LLM_TITLE)).toBeVisible({ timeout: 5000 });

      // 找到"大模型"卡片
      await expect(page.locator(HOME_PAGE_SELECTORS.LLM_CARD)).toBeVisible({ timeout: 5000 });

      console.log('✅ 首页大模型入口验证成功');
    } finally {
      await cleanup();
    }
  });

  test('大模型相关配置页面导航测试', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 大模型相关的配置页面
      const configPages = [
        { route: ROUTES.LLM_SERVICE, name: 'LM Studio 服务' },
        { route: ROUTES.LLM_CONFIG, name: 'LLM API 配置' },
      ];

      for (const pageInfo of configPages) {
        // 导航到配置页面
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
