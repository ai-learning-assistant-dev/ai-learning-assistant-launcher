import { useCallback, useEffect, useState } from 'react';
import { notification } from 'antd';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';
import {
  ObsidianConfig,
  ObsidianVaultConfig,
  ActionName,
  channel,
  ServiceName,
  ContainerConfig,
} from '../../../main/configs/type-info';
import { channel as cmdChannel } from '../../../main/cmd/type-info';

export default function useConfigs() {
  const [obsidianConfig, setObsidianConfig] = useState<ObsidianConfig>();
  const [obsidianVaultConfig, setObsidianVaultConfig] =
    useState<ObsidianVaultConfig[]>();
  const [containerConfig, setContainerConfig] = useState<ContainerConfig>();
  const [loading, setLoading] = useState(false);
  function action(
    actionName: ActionName,
    serviceName: ServiceName,
    extraData?: any,
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
      extraData,
    );
  }

  const query = useCallback(() => {
    window.electron.ipcRenderer.sendMessage(cmdChannel, 'query', 'obsidianApp');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'obsidianApp');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'obsidianVault');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'container');
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
          if (actionName === 'query' && service === 'obsidianApp') {
            console.debug('payload', payload);
            setObsidianConfig(payload);
            setLoading(false);
          } else if (actionName === 'query' && service === 'obsidianVault') {
            console.debug('payload', payload);
            setObsidianVaultConfig(payload);
            setLoading(false);
          } else if (actionName === 'query' && service === 'container') {
            console.debug('payload', payload);
            setContainerConfig(payload);
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
  }, [setObsidianConfig, setObsidianVaultConfig]);

  useEffect(() => {
    query();
  }, [query]);

  return {
    action,
    obsidianConfig,
    obsidianVaultConfig,
    containerConfig,
    loading,
  };
}
