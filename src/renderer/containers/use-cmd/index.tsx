import { useCallback, useEffect, useState } from 'react';
import { notification } from 'antd';
import { ActionName, channel, ServiceName } from '../../../main/cmd/type-info';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';

export default function useCmd() {
  const [isInstallWSL, setIsInstallWSL] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  function action(
    actionName: ActionName,
    serviceName: ServiceName,
    vaultId?: string,
  ) {
    if (loading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setLoading(true);
    window.electron.ipcRenderer.sendMessage(
      channel,
      actionName,
      serviceName,
      vaultId,
    );
  }

  const query = useCallback(function query() {
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'WSL');
  }, []);
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      channel,
      (messageType, data) => {
        console.debug(messageType, data);
        if (messageType === MESSAGE_TYPE.ERROR) {
          notification.error({
            message: data as string,
            placement: 'topRight',
          });
          setLoading(false);
        } else if (messageType === MESSAGE_TYPE.DATA) {
          const {
            action: actionName,
            service,
            data: payload,
          } = data as MessageData;
          if (actionName === 'query' && service === 'WSL') {
            setIsInstallWSL(payload);
          } else if (actionName === 'install' && service === 'WSL') {
            setIsInstallWSL(payload);
            setLoading(false);
          }
        } else if (messageType === MESSAGE_TYPE.INFO) {
          notification.success({
            message: data as string,
            placement: 'topRight',
          });
          query();
          setLoading(false);
        } else if (messageType === MESSAGE_TYPE.PROGRESS) {
          notification.success({
            message: data as string,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.PROGRESS_ERROR) {
          notification.error({
            message: data as string,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.WARNING) {
          notification.warning({
            message: data as string,
            placement: 'topRight',
          });
        }
      },
    );

    return () => {
      cancel();
    };
  }, [setIsInstallWSL]);

  useEffect(() => {
    query();
  }, [query]);

  return {
    isInstallWSL,
    action,
    loading,
  };
}
