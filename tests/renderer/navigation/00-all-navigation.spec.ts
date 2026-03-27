/**
 * 综合导航测试 - 所有主要页面
 *
 * 这个测试文件按顺序测试所有主要功能页面的导航
 * 适合作为完整的冒烟测试运行
 *
 * 测试顺序:
 * 1. 首页 (Hello) - /
 * 2. 阅读器 (Obsidian) - /obsidian-app
 * 3. 工具箱 (AI Toolbox) - /native-ai-service
 * 4. 大模型 (LLM Service) - /lm-service
 * 5. 学科培训 (Subject Training) - 首页功能
 *
 * ⚠️ 注意：使用 CDP 方式连接应用，因为 Playwright electron.launch 与 Electron 36.5.0 不兼容
 */
import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, ROUTES, HOME_PAGE_SELECTORS } from './test-helpers';

test.describe('🧭 全页面导航综合测试', () => {
  test('1️⃣ 首页应该正确加载', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 验证 body 元素存在
      await expect(page.locator('body')).toBeAttached({ timeout: 10000 });

      // 验证四个主要功能入口都存在（使用 feature-title 类精确匹配）
      await expect(page.locator(HOME_PAGE_SELECTORS.READER_TITLE)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(HOME_PAGE_SELECTORS.TOOLBOX_TITLE)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(HOME_PAGE_SELECTORS.LLM_TITLE)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(HOME_PAGE_SELECTORS.TRAINING_TITLE)).toBeVisible({ timeout: 5000 });

      console.log('✅ 首页加载完成，四个功能入口均存在');
    } finally {
      await cleanup();
    }
  });

  test('2️⃣ 应该能导航到阅读器页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      await navigateTo(page, ROUTES.READER.path);

      const url = page.url();
      expect(url).toContain('#/obsidian-app');
      console.log('✅ 阅读器页面导航成功');
    } finally {
      await cleanup();
    }
  });

  test('3️⃣ 应该能导航到工具箱页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      await navigateTo(page, ROUTES.TOOLBOX.path);

      const url = page.url();
      expect(url).toContain('#/native-ai-service');
      console.log('✅ 工具箱页面导航成功');
    } finally {
      await cleanup();
    }
  });

  test('4️⃣ 应该能导航到大模型页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      await navigateTo(page, ROUTES.LLM_SERVICE.path);

      const url = page.url();
      expect(url).toContain('#/lm-service');
      console.log('✅ 大模型页面导航成功');
    } finally {
      await cleanup();
    }
  });

  test('5️⃣ 应该能返回首页', async () => {
    const { page, cleanup } = await launchApp();

    try {
      await navigateTo(page, ROUTES.HOME.path);

      const url = page.url();
      expect(url).toContain('#/hello');
      console.log('✅ 返回首页成功');
    } finally {
      await cleanup();
    }
  });

  test('6️⃣ 首页学科培训功能应该可用', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 确保在首页
      await navigateTo(page, ROUTES.HOME.path);

      // 验证学科培训卡片存在
      const trainingCard = page.locator(HOME_PAGE_SELECTORS.TRAINING_CARD);
      await expect(trainingCard).toBeVisible({ timeout: 5000 });

      // 验证有操作按钮
      const buttons = trainingCard.locator('button');
      const buttonCount = await buttons.count();
      expect(buttonCount).toBeGreaterThan(0);

      console.log(`✅ 学科培训功能验证完成，找到 ${buttonCount} 个按钮`);
    } finally {
      await cleanup();
    }
  });
});

test.describe('🔄 快速路由切换测试', () => {
  test('应该能快速切换不同页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      const routes = [
        ROUTES.HOME.path,
        ROUTES.READER.path,
        ROUTES.TOOLBOX.path,
        ROUTES.LLM_SERVICE.path,
        ROUTES.HOME.path,
      ];

      for (const route of routes) {
        await navigateTo(page, route, 500);
        const url = page.url();
        expect(url).toContain(route.replace('#', ''));
      }

      console.log('✅ 快速路由切换测试通过');
    } finally {
      await cleanup();
    }
  });
});
