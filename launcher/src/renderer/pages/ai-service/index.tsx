import { Button, List, notification, Typography } from 'antd';
import { Link } from 'react-router-dom';
import './index.scss';
import type { ContainerInfo } from 'dockerode';
import { useState } from 'react';
import useDocker from '../../containers/use-docker';
import {
  ActionName,
  ServiceName,
} from '../../../main/podman-desktop/type-info';

interface ContainerItem {
  name: string;
  serviceName: ServiceName;
  state: '还未安装' | '已经停止' | '正在运行';
}

function getState(container?: ContainerInfo): ContainerItem['state'] {
  if (container) {
    if (container.State === 'running') {
      return '正在运行';
    }
    return '已经停止';
  }
  return '还未安装';
}

export default function AiService() {
  const { containers, action, loading } = useDocker();
  const [operating, setOperating] = useState<{
    serviceName: ServiceName;
    actionName: ActionName;
  }>({
    serviceName: 'LLM',
    actionName: 'install',
  });
  const llmContainer = containers.filter(
    (item) => item.Names.indexOf('LLM') >= 0,
  )[0];
  const ttsContainer = containers.filter(
    (item) => item.Names.indexOf('TTS') >= 0,
  )[0];
  const asrContainer = containers.filter(
    (item) => item.Names.indexOf('ASR') >= 0,
  )[0];

  const containerInfos: ContainerItem[] = [
    {
      name: '对话机器人',
      serviceName: 'LLM',
      state: getState(llmContainer),
    },
    {
      name: '语音转文字',
      serviceName: 'ASR',
      state: getState(asrContainer),
    },
    {
      name: '文字转语音',
      serviceName: 'TTS',
      state: getState(ttsContainer),
    },
  ];

  function click(actionName: ActionName, serviceName: ServiceName) {
    if (loading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setOperating({ actionName, serviceName });
    action(actionName, serviceName);
  }
  return (
    <div className="ai-service">
      <List
        className="ai-service-list"
        header={
          <Link to="/hello">
            <Button>返回</Button>
          </Link>
        }
        bordered
        dataSource={containerInfos}
        renderItem={(item) => (
          <List.Item
            actions={[
              item.state !== '还未安装' && (
                <Button
                  shape="round"
                  size="small"
                  loading={
                    loading &&
                    operating.serviceName === item.serviceName &&
                    operating.actionName === 'update'
                  }
                  onClick={() => click('update', item.serviceName)}
                >
                  更新
                </Button>
              ),
              item.state === '正在运行' && (
                <Button
                  shape="round"
                  size="small"
                  loading={
                    loading &&
                    operating.serviceName === item.serviceName &&
                    operating.actionName === 'stop'
                  }
                  onClick={() => click('stop', item.serviceName)}
                >
                  停止
                </Button>
              ),
              item.state === '已经停止' && (
                <Button
                  shape="round"
                  size="small"
                  loading={
                    loading &&
                    operating.serviceName === item.serviceName &&
                    operating.actionName === 'start'
                  }
                  onClick={() => click('start', item.serviceName)}
                >
                  启动
                </Button>
              ),
              item.state === '已经停止' && (
                <Button
                  shape="round"
                  size="small"
                  loading={
                    loading &&
                    operating.serviceName === item.serviceName &&
                    operating.actionName === 'remove'
                  }
                  onClick={() => click('remove', item.serviceName)}
                >
                  删除
                </Button>
              ),
              item.state === '还未安装' && (
                <Button
                  shape="round"
                  size="small"
                  loading={
                    loading &&
                    operating.serviceName === item.serviceName &&
                    operating.actionName === 'install'
                  }
                  onClick={() => click('install', item.serviceName)}
                >
                  安装
                </Button>
              ),
            ].filter((button) => button)}
          >
            <Typography.Text type="success">[{item.state}]</Typography.Text>
            {item.name}
          </List.Item>
        )}
      />
    </div>
  );
}
