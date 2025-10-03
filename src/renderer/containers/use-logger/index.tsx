import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';
import { ActionName, channel, ServiceName } from '../../../main/logger/type-info';

interface UseLoggerReturn {
  exporting: boolean;
  exportLog: () => Promise<string | void>;
}

export default function useLogger(): UseLoggerReturn {
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<{
    resolve: (value?: any) => void;
    reject: (reason?: any) => void;
  } | null>(null);

  useEffect(() => {
    const unsubscribe = window.electron?.ipcRenderer.on(
      channel,
      (messageType, data) => {
        if (!pending) {
          if (messageType === MESSAGE_TYPE.ERROR && typeof data === 'string') {
            message.error(data);
          } else if (messageType === MESSAGE_TYPE.INFO && typeof data === 'string') {
            message.success(data);
          }
          return;
        }

        if (messageType === MESSAGE_TYPE.ERROR) {
          message.error(String(data));
          pending.reject(data);
          setPending(null);
          setExporting(false);
        } else if (messageType === MESSAGE_TYPE.DATA) {
          const md = data as MessageData<ActionName, ServiceName, { destPath: string }>;
          pending.resolve(md?.data?.destPath);
          // 不在 DATA 处重置 exporting，等 INFO 收尾给到用户友好提示
        } else if (messageType === MESSAGE_TYPE.INFO) {
          if (typeof data === 'string') message.success(data);
          setPending(null);
          setExporting(false);
        }
      },
    );
    return () => unsubscribe && unsubscribe();
  }, [pending]);

  const exportLog = useCallback(() => {
    if (exporting) return Promise.reject('正在导出，请稍候');
    setExporting(true);
    return new Promise<string | void>((resolve, reject) => {
      setPending({ resolve, reject });
      window.electron.ipcRenderer.sendMessage(channel, 'export', 'LOG');
    });
  }, [exporting]);

  return { exporting, exportLog };
}

