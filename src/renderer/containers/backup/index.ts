import { useCallback } from "react";
import { message } from "antd";
import { MESSAGE_TYPE } from "../../../main/ipc-data-type";
import { ActionName, ServiceName } from "../../../main/backup/type-info";

export function useLogContainer() {
  // 使用 backup 通道方式调用日志导出功能
  const exportLogs = useCallback(() => {
    window.electron.ipcRenderer.sendMessage(
      'backup',
      'exportLogs',
      'log'
    );
  }, []);

  // 监听备份服务消息
  const setupBackupListener = useCallback((
    onSuccess?: (message: string) => void, 
    onError?: (error: string) => void
  ) => {
    const cancel = window.electron?.ipcRenderer.on(
      'backup',
      (messageType, data) => {
        if (messageType === MESSAGE_TYPE.ERROR) {
          const errorMessage = typeof data === 'string' ? data : '未知错误';
          message.error(errorMessage);
        } else if (messageType === MESSAGE_TYPE.INFO) {
          const infoMessage = typeof data === 'string' ? data : '操作成功完成';
          message.success(infoMessage);
        }
      }
    );

    return cancel;
  }, []);

  return {
    exportLogs,
    setupBackupListener
  };
}