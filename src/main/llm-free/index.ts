/**
 * 免密免费模型（Zen free lane）IPC 注册。
 *
 * 仅做「配置管理 + 本地转发代理」的桥接：把渲染进程的调用转交给
 * {@link getLlmFreeService} 的单例，并在退出前清理转发代理与持久化状态。
 * 真正的模型调用不在此发生。
 *
 * @module src/main/llm-free/index.ts
 */

import { IpcMain, app } from 'electron'
import { ipcHandle } from '../ipc-util'
import {
  llmFreeQueryConfigHandle,
  llmFreeSetConfigHandle,
  llmFreeStartHandle,
  llmFreeStopHandle,
  llmFreeStatusHandle,
  llmFreeRegenerateKeyHandle,
  llmFreeProbeHandle,
  llmFreeCatalogHandle,
  llmFreeModelsHandle,
} from './type-info'
import { getLlmFreeService } from './service'

/**
 * 注册免密免费模型相关的所有 IPC 处理器。
 * 处理器遵循 `ipcHandle` 约定：成功返回 `{result}`，异常返回 `{error}`。
 */
export default function initLlmFree(ipcMain: IpcMain): void {
  // 退出前关闭转发代理、落盘持久化状态（不残留后台监听端口）。
  app.on('before-quit', () => {
    getLlmFreeService().dispose()
  })

  ipcHandle(ipcMain, llmFreeQueryConfigHandle, async () =>
    getLlmFreeService().getConfig(),
  )

  ipcHandle(ipcMain, llmFreeSetConfigHandle, async (_event, patch: Record<string, unknown>) =>
    getLlmFreeService().setConfig(patch as any),
  )

  ipcHandle(ipcMain, llmFreeStartHandle, async () =>
    getLlmFreeService().start(),
  )

  ipcHandle(ipcMain, llmFreeStopHandle, async () =>
    getLlmFreeService().stop(),
  )

  ipcHandle(ipcMain, llmFreeStatusHandle, async () =>
    getLlmFreeService().getStatus(),
  )

  ipcHandle(ipcMain, llmFreeRegenerateKeyHandle, async () =>
    getLlmFreeService().regenerateKey(),
  )

  ipcHandle(ipcMain, llmFreeProbeHandle, async () =>
    getLlmFreeService().probe(),
  )

  ipcHandle(ipcMain, llmFreeCatalogHandle, async () =>
    getLlmFreeService().refreshCatalogNow(),
  )

  ipcHandle(ipcMain, llmFreeModelsHandle, async () =>
    getLlmFreeService().getModels(),
  )

  // 上次会话已启用 → 随启动器自动拉起（转发代理 + catalog/probe），无需手动点启动。
  if (getLlmFreeService().getConfig().enabled) {
    void getLlmFreeService().start().catch(() => {})
  }
}

export { getLlmFreeService }
