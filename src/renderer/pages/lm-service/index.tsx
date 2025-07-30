import {
  Button,
  List,
  Modal,
  notification,
  Popconfirm,
  Typography,
} from 'antd';
import { Link, NavLink } from 'react-router-dom';
import './index.scss';
import type { ContainerInfo } from 'dockerode';
import { useEffect, useState } from 'react';
import useDocker from '../../containers/use-docker';
import { ActionName, LMModel, modelKeyDict, ServerStatus, ServiceName } from '../../../main/lm-studio/type-info';
import {
  ActionName as CmdActionName,
  ServiceName as CmdServiceName,
  channel as cmdChannel,
} from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';
import useLMStudio from '../../containers/use-lm-studio';

interface ModelItem {
  name: string;
  serviceName: ServiceName;
  state: '还未安装' | '已经安装' | '已经加载';
}

function getState(lMModel?: LMModel, lmServerStatus?: ServerStatus): ModelItem['state'] {
  if (lMModel) {
    if (lMModel.isLoaded && lmServerStatus && lmServerStatus.running) {
      return '已经加载';
    }
    return '已经安装';
  }
  return '还未安装';
}

export default function LMService() {
  const { lmServerStatus, lMModels, action, loading, initing } = useLMStudio();
  const {
    isInstallWSL,
    checkingWsl,
    isInstallLMStudio,
    action: cmdAction,
    loading: cmdLoading,
  } = useCmd();
  // const [showRebootModal, setShowRebootModal] = useState(false);
  const [operating, setOperating] = useState<{
    serviceName: ServiceName;
    actionName: ActionName;
  }>({
    serviceName: 'qwen/qwen3-32b',
    actionName: 'install',
  });
  const [cmdOperating, setCmdOperating] = useState<{
    serviceName: CmdServiceName;
    actionName: CmdActionName;
  }>({
    serviceName: 'WSL',
    actionName: 'install',
  });
  // const llmContainer = containers.filter(
  //   (item) => item.Names.indexOf() >= 0,
  // )[0];
  const textEmbedding = lMModels.filter(
    (item) => item.modelKey === modelKeyDict['qwen/qwen3-embedding-0.6b'],
  )[0];
  const qwen3_32b = lMModels.filter(
    (item) => item.modelKey === modelKeyDict['qwen/qwen3-32b'],
  )[0];

  const modelInfos: ModelItem[] = [
    {
      name: 'qwen3-32b',
      serviceName: 'qwen/qwen3-32b',
      state: getState(qwen3_32b, lmServerStatus),
    },
    {
      name: 'text-embedding',
      serviceName: 'qwen/qwen3-embedding-0.6b',
      state: getState(textEmbedding, lmServerStatus),
    },
  ];

  function click(actionName: ActionName, serviceName: ServiceName) {
    if (loading || checkingWsl) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setOperating({ actionName, serviceName });
    action(actionName, serviceName);
  }

  function clickCmd(actionName: CmdActionName, serviceName: CmdServiceName) {
    if (cmdLoading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setCmdOperating({ actionName, serviceName });
    cmdAction(actionName, serviceName);
  }

  return (
    <div className="lm-service">
      <List
        className="lm-service-list"
        header={
          <div className="header-container">
            <Link to="/hello">
              <Button disabled={loading || cmdLoading}>返回</Button>
            </Link>
            <div>
              <Popconfirm
                title="删除所有模型和缓存"
                description="你确定要删除所有模型和缓存吗？删除后再次安装会需要很长时间！"
                onConfirm={() => clickCmd('remove', 'lm-studio')}
                okText="确认删除"
                cancelText="不删除"
              >
                <Button
                  disabled={!isInstallWSL || cmdLoading || loading}
                  type="primary"
                  shape="round"
                  danger
                  loading={
                    cmdLoading &&
                    cmdOperating.serviceName === 'lm-studio' &&
                    cmdOperating.actionName === 'remove'
                  }
                >
                  删除所有服务和缓存
                </Button>
              </Popconfirm>
              <div style={{ width: '20px', display: 'inline-block' }}></div>
              <Button
                disabled={isInstallLMStudio}
                type="primary"
                shape="round"
                loading={
                  checkingWsl ||
                  (cmdLoading &&
                    cmdOperating.serviceName === 'lm-studio' &&
                    cmdOperating.actionName === 'install')
                }
                onClick={() => clickCmd('install', 'lm-studio')}
              >
                {isInstallLMStudio
                  ? '已安装LMStudio'
                  : '开启本地大模型前请点我安装LMStudio'}
              </Button>
            </div>
          </div>
        }
        bordered
        dataSource={modelInfos}
        renderItem={(item) => (
          <List.Item
            actions={[
              `http://127.0.0.1:${lmServerStatus.port}`,
              <NavLink key="config" to={`/${item.serviceName}-config`}>
                <Button
                  shape="round"
                  size="small"
                  disabled={
                    !isInstallWSL || checkingWsl || loading || cmdLoading
                  }
                >
                  设置
                </Button>
              </NavLink>,
              item.state !== '还未安装' && (
                <Button
                  shape="round"
                  size="small"
                  disabled={!isInstallWSL || checkingWsl || cmdLoading}
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
              item.state === '已经加载' && (
                <Button
                  shape="round"
                  size="small"
                  disabled={!isInstallWSL || checkingWsl || cmdLoading || !isInstallLMStudio}
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
              item.state === '已经安装' && (
                <Button
                  shape="round"
                  size="small"
                  disabled={!isInstallWSL || checkingWsl || cmdLoading || !isInstallLMStudio}
                  loading={
                    loading &&
                    operating.serviceName === item.serviceName &&
                    operating.actionName === 'start'
                  }
                  type="primary"
                  onClick={() => click('start', item.serviceName)}
                >
                  加载
                </Button>
              ),
              item.state === '已经安装' && (
                <Popconfirm
                  title="删除容器"
                  description="你确定要删除模型？删除后再次安装会需要较长时间！"
                  onConfirm={() => click('remove', item.serviceName)}
                  okText="确认删除"
                  cancelText="不删除"
                >
                  <Button
                    shape="round"
                    size="small"
                    disabled={!isInstallWSL || checkingWsl || cmdLoading}
                    loading={
                      loading &&
                      operating.serviceName === item.serviceName &&
                      operating.actionName === 'remove'
                    }
                    color="danger"
                    danger
                  >
                    删除
                  </Button>
                </Popconfirm>
              ),
              item.state === '还未安装' && (
                <Button
                  shape="round"
                  size="small"
                  disabled={!isInstallWSL || checkingWsl || cmdLoading}
                  loading={
                    initing ||
                    (loading &&
                      operating.serviceName === item.serviceName &&
                      operating.actionName === 'install')
                  }
                  onClick={() => click('install', item.serviceName)}
                  type="primary"
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
