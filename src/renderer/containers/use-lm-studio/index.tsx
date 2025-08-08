import { useEffect, useState } from 'react';
import { notification } from 'antd';
import type Dockerode from 'dockerode';
import {
  ActionName,
  channel,
  LMModel,
  ServerStatus,
  ServiceName,
} from '../../../main/lm-studio/type-info';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';

export default function useLMStudio() {
  const [lMModels, setLMModels] = useState<LMModel[]>([]);
  const [lmServerStatus, setLmServerStatus] = useState<ServerStatus>({
    running: false,
    port: 1234,
  });
  const [loading, setLoading] = useState(false);
  const [initing, setIniting] = useState(true);
  function action(actionName: ActionName, serviceName: ServiceName) {
    if (initing) {
      notification.warning({
        message: '正在获取服务状态，请稍等',
        placement: 'topRight',
      });
      return;
    }
    if (loading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setLoading(true);
    window.electron.ipcRenderer.sendMessage(channel, actionName, serviceName);
  }

  function queryServicese() {
    window.electron.ipcRenderer.sendMessage(channel, 'query');
  }
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      channel,
      (messageType: MESSAGE_TYPE, data: any) => {
        console.debug(messageType, data);
        if (messageType === MESSAGE_TYPE.ERROR) {
          notification.error({ message: data, placement: 'topRight' });
          setLoading(false);
          setIniting(false);
        } else if (messageType === MESSAGE_TYPE.DATA) {
          const d = data as MessageData<
            ActionName,
            ServiceName,
            {models: LMModel[], serverStatus: ServerStatus}
          >;
          if (d.action === 'query') {
            setLMModels(d.data.models);
            setLmServerStatus(d.data.serverStatus);
            if (initing) {
              setIniting(false);
            }
          }
        } else if (messageType === MESSAGE_TYPE.INFO) {
          notification.success({ message: data, placement: 'topRight' });
          queryServicese();
          setLoading(false);
        } else if (messageType === MESSAGE_TYPE.PROGRESS) {
          notification.success({ message: data, placement: 'topRight' });
        } else if (messageType === MESSAGE_TYPE.PROGRESS_ERROR) {
          notification.error({ message: data, placement: 'topRight' });
        } else if (messageType === MESSAGE_TYPE.WARNING) {
          notification.warning({ message: data, placement: 'topRight' });
        }
      },
    );
    return () => {
      cancel();
    };
  }, [initing, setLMModels, setIniting, setLoading]);

  useEffect(() => {
    queryServicese();
  }, []);

  return {
    lMModels,
    action,
    loading,
    initing,
    lmServerStatus,
  };
}
