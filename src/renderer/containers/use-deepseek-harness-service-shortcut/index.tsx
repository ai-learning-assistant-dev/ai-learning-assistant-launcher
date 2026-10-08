import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import {
  DeepseekHarnessServiceInfo,
  WorkbuddyModelSyncResult,
} from '../../../main/deepseek-harness-service/type-info';

// 把未知错误转成可展示的文本
function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized || '未知错误';
  } catch {
    return String(error);
  }
}

export function useDeepseekHarnessServiceShortcut() {
  const [initing, setIniting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serviceInfo, setServiceInfo] = useState<DeepseekHarnessServiceInfo>({
    state: 'not_install',
  });

  const queryServiceInfo = useCallback(async () => {
    const info = await window.mainHandle.queryDeepseekHarnessServiceHandle();
    setServiceInfo(info);
  }, []);

  // 首次进入页面加载服务状态；失败也要结束 loading，避免一直停留在“检测中”
  useEffect(() => {
    queryServiceInfo()
      .catch((e) => {
        console.error('[DeepSeekHarness] 首次查询服务状态失败:', e);
        message.error(`查询服务状态失败：${getErrorMessage(e)}`);
      })
      .finally(() => setIniting(false));
  }, [queryServiceInfo]);

  const showError = useCallback((action: string, error: unknown) => {
    console.error(`[DeepSeekHarness] ${action}失败:`, error);
    message.error(`${action}失败：${getErrorMessage(error)}`);
  }, []);

  // 执行业务动作：出错时展示错误提示，并且无论如何都重新查询服务状态；
  // 若连查询也失败，则恢复执行前的快照，避免停留在 installing/uninstalling 等中间态导致页面假死
  const runAction = useCallback(
    async (params: {
      actionName: string;
      busyState?: DeepseekHarnessServiceInfo['state'];
      action: () => Promise<unknown>;
    }) => {
      const snapshot = serviceInfo;
      if (params.busyState) {
        setServiceInfo((prev) => ({ ...prev, state: params.busyState }));
      }
      try {
        await params.action();
      } catch (e) {
        showError(params.actionName, e);
      } finally {
        try {
          await queryServiceInfo();
        } catch (e) {
          console.error('[DeepSeekHarness] 执行后查询服务状态失败:', e);
          setServiceInfo(snapshot);
        }
      }
    },
    [serviceInfo, queryServiceInfo, showError],
  );

  const install = useCallback(async () => {
    if (serviceInfo.state !== 'installed') {
      await runAction({
        actionName: '安装',
        busyState: 'installing',
        action: () => window.mainHandle.installDeepseekHarnessServiceHandle(),
      });
    }
  }, [serviceInfo.state, runAction]);

  const remove = useCallback(async () => {
    if (serviceInfo.state === 'installed') {
      await runAction({
        actionName: '卸载',
        busyState: 'uninstalling',
        action: () => window.mainHandle.removeDeepseekHarnessServiceHandle(),
      });
    }
  }, [serviceInfo.state, runAction]);

  const run = useCallback(async () => {
    await runAction({
      actionName: '启动',
      action: () => window.mainHandle.runDeepseekHarnessServiceHandle(),
    });
  }, [runAction]);

  const stop = useCallback(async () => {
    await runAction({
      actionName: '停止',
      action: () => window.mainHandle.stopDeepseekHarnessServiceHandle(),
    });
  }, [runAction]);

  const openWindow = useCallback(async () => {
    await runAction({
      actionName: '打开页面',
      action: () => window.mainHandle.openDeepseekHarnessWindowHandle(),
    });
  }, [runAction]);

  const copyPageLink = useCallback(async () => {
    await runAction({
      actionName: '复制链接',
      action: () => window.mainHandle.copyDeepseekHarnessDashboardUrlHandle(),
    });
  }, [runAction]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryServiceInfo();
    } catch (e) {
      showError('刷新服务状态', e);
    } finally {
      setRefreshing(false);
    }
  }, [queryServiceInfo, showError]);

  const [syncingWorkbuddyModels, setSyncingWorkbuddyModels] = useState(false);

  const [creatingShortcut, setCreatingShortcut] = useState(false);

  /**
   * 创建桌面快捷方式：双击它直接拉起 dsh 界面（快捷方式带 `--start-dsh` 参数），
   * 不必先打开启动器主界面再点「运行」。
   * 结果（新建还是覆盖更新、文件位置）直接提示出来，失败原因也一并展示。
   */
  const createShortcut = useCallback(async () => {
    setCreatingShortcut(true);
    try {
      const result = await window.mainHandle.createDshShortcutHandle();
      message.success(
        `桌面快捷方式已${result.created ? '创建' : '更新'}：${result.path}`,
      );
    } catch (e) {
      showError('创建桌面快捷方式', e);
    } finally {
      setCreatingShortcut(false);
    }
  }, [showError]);

  /**
   * 把 WorkBuddy 的模型配置同步进 dsh。
   * 不改动服务状态，所以不走 runAction（不需要重新查询服务信息）；
   * 错误交给调用方用弹窗展示（只在这里留一条 console 记录），避免和调用方的提示重复。
   */
  const syncWorkbuddyModels =
    useCallback(async (): Promise<WorkbuddyModelSyncResult> => {
      setSyncingWorkbuddyModels(true);
      try {
        return await window.mainHandle.syncWorkbuddyModelsToDshHandle();
      } catch (e) {
        console.error('[DeepSeekHarness] 同步 WorkBuddy 模型配置失败:', e);
        throw e;
      } finally {
        setSyncingWorkbuddyModels(false);
      }
    }, []);

  /** 在系统文件管理器里打开备份目录 */
  const openBackupDir = useCallback(
    async (dir?: string) => {
      try {
        await window.mainHandle.openDeepseekHarnessBackupDirHandle(dir);
      } catch (e) {
        showError('打开备份目录', e);
      }
    },
    [showError],
  );

  return {
    initing,
    refreshing,
    state: serviceInfo.state,
    version: serviceInfo.version,
    running: serviceInfo.running ?? false,
    port: serviceInfo.port,
    install,
    remove,
    run,
    stop,
    openWindow,
    copyPageLink,
    refresh,
    syncingWorkbuddyModels,
    syncWorkbuddyModels,
    openBackupDir,
    creatingShortcut,
    createShortcut,
  };
}
