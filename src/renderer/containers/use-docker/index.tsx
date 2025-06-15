import { useEffect, useState } from 'react';
import { notification } from 'antd';
import type Dockerode from 'dockerode';
import {
  ActionName,
  ServiceName,
} from '../../../main/podman-desktop/type-info';

export default function useDocker() {
  const [containers, setContainers] = useState<Dockerode.ContainerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  function action(actionName: ActionName, serviceName: ServiceName) {
    if (loading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setLoading(true);
    window.electron.ipcRenderer.sendMessage('docker', actionName, serviceName);
  }

  function queryContainers() {
    window.electron.ipcRenderer.sendMessage('docker', 'query');
  }
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      'docker',
      (messageType: 'error' | 'info' | 'data', data: any) => {
        console.debug(messageType, data);
        if (messageType === 'error') {
          notification.error({ message: data, placement: 'topRight' });
        } else if (messageType === 'data') {
          setContainers(data);
        } else if (messageType === 'info') {
          notification.success({ message: data, placement: 'topRight' });
          queryContainers();
          setLoading(false);
        }
      },
    );

    return () => {
      cancel();
    };
  }, [setContainers]);

  useEffect(() => {
    queryContainers();
  }, []);

  return {
    containers,
    action,
    loading,
  };
}
