import { useCallback } from "react";
import { MESSAGE_TYPE } from "../../../main/ipc-data-type";
import { ActionName, ServiceName } from "../../../main/log-main/type-info";

export function useLogContainer() {
  // 使用标准的 configs 通道方式调用日志目录打开功能
  const openLogsDirectory = useCallback(() => {
    window.electron.ipcRenderer.sendMessage(
      'configs',
      'openLogsDirectory',
      'log'
    );
  }, []);

  // 监听日志服务消息
  const setupLogListener = useCallback((
    onSuccess?: () => void, 
    onError?: (error: string) => void
  ) => {
    const cancel = window.electron?.ipcRenderer.on(
      'configs',
      (messageType, data) => {
        if (messageType === MESSAGE_TYPE.ERROR) {
          const errorMessage = typeof data === 'string' ? data : '未知错误';
          onError?.(errorMessage);
        } else if (messageType === MESSAGE_TYPE.INFO) {
          onSuccess?.();
        }
      }
    );

    return cancel;
  }, []);

  return {
    openLogsDirectory,
    setupLogListener
  };
}