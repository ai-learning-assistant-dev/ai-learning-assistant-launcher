import { useEffect, useState } from 'react';
import { notification } from 'antd';
import type Dockerode from 'dockerode';
import {
  ActionName,
  channel,
  ServiceName,
} from '../../../main/podman-desktop/type-info';
import {
  ActionName as CmdActionName,
  channel as cmdChannel,
  ServiceName as CmdServiceName,
} from '../../../main/cmd/type-info';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';

export default function useDocker() {
  const [containers, setContainers] = useState<Dockerode.ContainerInfo[]>([]);
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

  function queryContainers() {
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
        } else if (messageType === MESSAGE_TYPE.DATA) {
          const d = data as MessageData<
            ActionName,
            ServiceName,
            Dockerode.ContainerInfo[] | string
          >;
          if (d.action === 'query') {
            setContainers(d.data as Dockerode.ContainerInfo[]);
            if (initing) {
              setIniting(false);
            }
          }
        } else if (messageType === MESSAGE_TYPE.INFO) {
          notification.success({ message: data, placement: 'topRight' });
          queryContainers();
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

    const cancel2 = window.electron?.ipcRenderer.on(
      cmdChannel,
      (messageType: MESSAGE_TYPE, data: any) => {
        if (messageType === MESSAGE_TYPE.DATA) {
          const d = data as MessageData<CmdActionName, CmdServiceName, boolean>;
          if (d.action === 'remove' && d.service === 'podman') {
            setContainers([]);
          }
        }
      },
    );

    return () => {
      cancel();
      cancel2();
    };
  }, [initing, setContainers, setIniting, setLoading]);

  useEffect(() => {
    queryContainers();
  }, []);

  return {
    containers,
    action,
    loading,
    initing,
  };
}
