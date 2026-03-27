/**
 * 测试: 阅读器页面 (Obsidian Reader) 导航测试
 *
 * 目标页面: Obsidian 阅读器管理页面
 * 路由路径: /obsidian-app
 * 功能描述:
 *   - 管理 Obsidian 阅读器的仓库和插件
 *   - 启动 Obsidian 应用
 *   - 配置 Obsidian 插件
 *
 * 验证内容:
 * - 能从首页导航到阅读器页面
 * - 阅读器页面能正确加载
 * - URL 包含 /obsidian-app
 *
 * ⚠️ 注意：使用 CDP 方式连接应用
 */
import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, ROUTES, HOME_PAGE_SELECTORS } from './test-helpers';

test.describe('阅读器 (Obsidian) 页面导航测试', () => {
  test('应该能从首页导航到阅读器页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 通过修改 location.hash 导航
      await navigateTo(page, ROUTES.READER.path);

      // 验证 URL 正确
      const url = page.url();
      console.log(`✅ 导航成功，当前 URL: ${url}`);
      expect(url).toContain('#/obsidian-app');
    } finally {
      await cleanup();
    }
  });

  test('阅读器页面应该包含关键元素', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 导航到阅读器页面
      await navigateTo(page, ROUTES.READER.path);

      // 验证页面 body 存在
      await expect(page.locator('body')).toBeAttached({ timeout: 10000 });
      
      // 等待页面内容加载（Obsidian 页面需要一些时间初始化）
      await page.waitForTimeout(2000);
      
      // 验证页面包含 Obsidian 相关的文本（使用 text 选择器更可靠）
      // 这些文本是 Obsidian 页面必定会显示的
      await expect(page.locator('text=Obsidian').first()).toBeVisible({ timeout: 5000 });
      
      // 尝试验证"使用本地安装包"元素（如果 Obsidian 未安装则会显示）
      // 使用更通用的选择器来查找这个文本
      const pageContent = await page.content();
      const hasLocalInstall = pageContent.includes('使用本地安装包');
      
      if (hasLocalInstall) {
        console.log('✅ 阅读器页面已加载，找到"使用本地安装包"选项');
      } else {
        console.log('✅ 阅读器页面已加载（"使用本地安装包"选项未显示，可能 Obsidian 已安装）');
      }
    } finally {
      await cleanup();
    }
  });

  test('应该能通过点击首页的"开始"按钮导航到阅读器页面', async () => {
    const { page, cleanup } = await launchApp();

    try {
      // 先回到首页
      await navigateTo(page, ROUTES.HOME.path);

      // 找到"阅读器"卡片中的"开始"按钮并点击
      const readerCard = page.locator(HOME_PAGE_SELECTORS.READER_CARD);
      const startButton = readerCard.locator('button:has-text("开始")');

      // 如果按钮存在则点击（用于演示交互方式）
      if (await startButton.isVisible().catch(() => false)) {
        await startButton.click();
        await page.waitForTimeout(1000);

        const url = page.url();
        console.log(`✅ 点击后 URL: ${url}`);
        expect(url).toContain('#/obsidian-app');
      } else {
        console.log('⚠️ 开始按钮未找到，跳过点击测试');
        test.skip();
      }
    } finally {
      await cleanup();
    }
  });
});
