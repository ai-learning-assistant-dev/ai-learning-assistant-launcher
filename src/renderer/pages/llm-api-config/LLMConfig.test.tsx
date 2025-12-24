/**
 * @jest-environment jsdom
 * run the test  npm test src/renderer/pages/llm-api-config/LLMConfig.test.tsx
 */
import '@testing-library/jest-dom';               // 匹配器 toBeInTheDocument 等

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LLMConfig from './index';                  // 被测页面组件

/* ================== 统一 Mock 外部世界 ================== */
// 1. useConfigs Hook → 可控假数据
const mockConfigs = {
  llmConfig: { models: [] },
  loading: false,
  testingResult: null,
  action: jest.fn(() => Promise.resolve()),
};
// src/renderer/containers/use-configs/index.tsx
jest.mock('@/renderer/containers/use-configs', () => ({
  __esModule: true,
  default: () => mockConfigs,
}));

// 2. antd message → 静音
jest.mock('antd', () => {
  const antd = jest.requireActual('antd');
  return { ...antd, message: { error: jest.fn(), warning: jest.fn() } };
});

/* ================== 渲染封装 ================== */
const renderPage = () =>
  render(
    <MemoryRouter>
      <LLMConfig />
    </MemoryRouter>,
  );

/* ================== 黄金用例 ================== */
test('添加 OpenAI 模型 -> 测试通过 -> 保存成功', async () => {
  mockConfigs.testingResult = { success: true, message: 'ok' };

  renderPage();
});