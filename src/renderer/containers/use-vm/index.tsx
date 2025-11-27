import { notification } from 'antd';
import { useState, useEffect } from 'react';
import { channel, ActionName, ServiceName } from '../../../main/cmd/type-info';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';

export function useVM() {
  // WSL相关状态
  const [isWSLInstalled, setIsWSLInstalled] = useState<boolean>(false);
  const [wslVersion, setWSLVersion] = useState<string>('');
  const [wslChecking, setWSLChecking] = useState<boolean>(true);
  const [wslLoading, setWSLLoading] = useState<boolean>(false);
  const [wslOperation, setWSLOperation] = useState<{
    action: string;
    service: string;
  }>({ action: '', service: '' });

  const [isPodmanInstalled, setIsPodmanInstalled] = useState<boolean>(false);
  const [podmanChecking, setPodmanChecking] = useState<boolean>(true);

  // WSL操作函数
  const handleCmdAction = (action: ActionName, service: ServiceName) => {
    if (wslLoading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }

    setWSLLoading(true);
    setWSLOperation({ action, service });

    window.electron?.ipcRenderer.sendMessage(channel, action, service);
  };

  // 初始化时检查WSL状态
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      channel,
      (messageType: any, data: any) => {
        if (messageType === MESSAGE_TYPE.ERROR) {
          notification.error({
            message: data,
            placement: 'topRight',
          });
          setWSLLoading(false);
          setWSLOperation({ action: 'query', service: 'WSL' });
        } else if (messageType === MESSAGE_TYPE.DATA) {
          const messageData: MessageData<ActionName, ServiceName, any> = data;
          const { action: actionName, service, data: payload } = messageData;

          if (actionName === 'query' && service === 'WSL') {
            setIsWSLInstalled(payload.installed);
            setWSLVersion(payload.version);
            setWSLChecking(false);
          } else if (actionName === 'query' && service === 'podman') {
            setIsPodmanInstalled(payload.installed);
            setPodmanChecking(false);
          } else if (
            (actionName === 'install' || actionName === 'update') &&
            service === 'WSL'
          ) {
            setIsWSLInstalled(payload.installed);
            setWSLVersion(payload.version);
            setWSLLoading(false);
            setWSLOperation({ action: 'query', service: 'WSL' });

            if (actionName === 'install') {
              notification.success({
                message: 'WSL安装完成，需要重启计算机才能生效',
                placement: 'topRight',
              });
            }
          } else if (actionName === 'move' && service === 'podman') {
            setWSLLoading(false);
            setWSLOperation({ action: 'query', service: 'WSL' });
            notification.success({
              message: '成功修改安装位置',
              placement: 'topRight',
            });
          } else if (actionName === 'remove' && service === 'podman') {
            setWSLLoading(false);
            setWSLOperation({ action: 'query', service: 'WSL' });
            notification.success({
              message: '成功删除所有服务和缓存',
              placement: 'topRight',
            });
          }
        } else if (messageType === MESSAGE_TYPE.INFO) {
          notification.success({
            message: data,
            placement: 'topRight',
          });
          // 重新查询状态
          window.electron?.ipcRenderer.sendMessage(channel, 'query', 'WSL');
          window.electron?.ipcRenderer.sendMessage(channel, 'query', 'podman');
          setWSLLoading(false);
          setWSLOperation({ action: 'query', service: 'WSL' });
        } else if (messageType === MESSAGE_TYPE.PROGRESS) {
          notification.info({
            message: data,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.PROGRESS_ERROR) {
          notification.error({
            message: data,
            placement: 'topRight',
          });
          setWSLLoading(false);
          setWSLOperation({ action: 'query', service: 'WSL' });
        } else if (messageType === MESSAGE_TYPE.WARNING) {
          notification.warning({
            message: data,
            placement: 'topRight',
          });
        }
      },
    );

    // 初始查询WSL状态
    window.electron?.ipcRenderer.sendMessage(channel, 'query', 'WSL');

    window.electron?.ipcRenderer.sendMessage(channel, 'query', 'podman');

    return () => {
      if (cancel) cancel();
    };
  }, []);

  return {
    isPodmanInstalled,
    podmanChecking,
    isWSLInstalled,
    wslVersion,
    wslChecking,
    wslLoading,
    wslOperation,
    handleCmdAction,
  };
}
