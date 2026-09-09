import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import { OpenclawServiceInfo } from '../../../main/openclaw-service/type-info';

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

export function useOpenclawServiceShortcut() {
  const [initing, setIniting] = useState(true);
  const [serviceInfo, setServiceInfo] = useState<OpenclawServiceInfo>({
    state: 'not_install',
  });

  const queryServiceInfo = useCallback(async () => {
    const info = await window.mainHandle.queryOpenclawServiceHandle();
    setServiceInfo(info);
  }, []);

  // 首次进入页面加载服务状态；失败也要结束 loading，避免一直停留在“检测中”
  useEffect(() => {
    queryServiceInfo()
      .catch((e) => {
        console.error('[OpenClaw] 首次查询服务状态失败:', e);
        message.error(`查询服务状态失败：${getErrorMessage(e)}`);
      })
      .finally(() => setIniting(false));
  }, [queryServiceInfo]);

  const showError = useCallback((action: string, error: unknown) => {
    console.error(`[OpenClaw] ${action}失败:`, error);
    message.error(`${action}失败：${getErrorMessage(error)}`);
  }, []);

  // 执行业务动作：出错时展示错误提示，并且无论如何都重新查询服务状态；
  // 若连查询也失败，则恢复执行前的快照，避免停留在 installing/uninstalling 等中间态导致页面假死
  const runAction = useCallback(
    async (params: {
      actionName: string;
      busyState?: OpenclawServiceInfo['state'];
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
          console.error('[OpenClaw] 执行后查询服务状态失败:', e);
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
        action: () => window.mainHandle.installOpenclawServiceHandle(),
      });
    }
  }, [serviceInfo.state, runAction]);

  const remove = useCallback(async () => {
    if (serviceInfo.state === 'installed') {
      await runAction({
        actionName: '卸载',
        busyState: 'uninstalling',
        action: () => window.mainHandle.removeOpenclawServiceHandle(),
      });
    }
  }, [serviceInfo.state, runAction]);

  const run = useCallback(async () => {
    await runAction({
      actionName: '启动',
      action: () => window.mainHandle.runOpenclawServiceHandle(),
    });
  }, [runAction]);

  const stop = useCallback(async () => {
    await runAction({
      actionName: '停止',
      action: () => window.mainHandle.stopOpenclawServiceHandle(),
    });
  }, [runAction]);

  const openWindow = useCallback(async () => {
    await runAction({
      actionName: '打开页面',
      action: () => window.mainHandle.openOpenclawWindowHandle(),
    });
  }, [runAction]);

  const copyPageLink = useCallback(async () => {
    await runAction({
      actionName: '复制链接',
      action: () => window.mainHandle.copyOpenclawDashboardUrlHandle(),
    });
  }, [runAction]);

  const refresh = useCallback(async () => {
    try {
      await queryServiceInfo();
    } catch (e) {
      showError('刷新服务状态', e);
    }
  }, [queryServiceInfo, showError]);

  return {
    initing,
    state: serviceInfo.state,
    version: serviceInfo.version,
    running: serviceInfo.running ?? false,
    install,
    remove,
    run,
    stop,
    openWindow,
    copyPageLink,
    refresh,
  };
}
