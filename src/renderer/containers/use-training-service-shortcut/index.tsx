import type { ContainerInfo } from 'dockerode';
import {
  containerNameDict,
  ServiceName,
} from '../../../main/podman-desktop/type-info';
import useDocker from '../use-docker';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export interface ContainerItem {
  name: string;
  serviceName: ServiceName;
  state: '还未安装' | '已经停止' | '正在运行' | '正在启动';
  port: number;
}

export function getState(container?: ContainerInfo): ContainerItem['state'] {
  if (container) {
    if (container.State === 'running') {
      if (container.Status === 'healthy') {
        return '正在运行';
      } else if (container.Status === 'starting') {
        return '正在启动';
      }
    }
    return '已经停止';
  }
  return '还未安装';
}

export function useTrainingServiceShortcut() {
  const navigate = useNavigate();
  const [dockerDatatrigger, setDockerDatatrigger] = useState(1);
  const { containers, action, loading, initing } = useDocker(dockerDatatrigger);

  const trainingContainer = containers.filter(
    (item) => item.Names.indexOf(containerNameDict.TRAINING) >= 0,
  )[0];

  const containerInfos: ContainerItem[] = [
    {
      name: '学科培训',
      serviceName: 'TRAINING',
      state: getState(trainingContainer),
      port: 7100,
    },
  ];

  const start = async () => {
    if (containerInfos[0].state === '还未安装') {
      await window.mainHandle.installTrainingServiceHandle();
      await window.mainHandle.startTrainingServiceHandle();
      setDockerDatatrigger(dockerDatatrigger + 1);
    } else if (containerInfos[0].state === '已经停止') {
      containerInfos[0].state = '正在启动';
      await window.mainHandle.startTrainingServiceHandle();
      setDockerDatatrigger(dockerDatatrigger + 1);
    } else if (containerInfos[0].state === '正在启动') {
      await window.mainHandle.startTrainingServiceHandle();
      setDockerDatatrigger(dockerDatatrigger + 1);
    } else if (containerInfos[0].state === '正在运行') {
      await window.mainHandle.startTrainingServiceHandle();
    }
  };

  const remove = async () => {
    if (containerInfos[0].state !== '还未安装') {
      await window.mainHandle.removeTrainingServiceHandle();
      setDockerDatatrigger(dockerDatatrigger + 1);
    }
  };

  return {
    state: containerInfos[0].state,
    start,
    remove,
    initing,
  };
}
