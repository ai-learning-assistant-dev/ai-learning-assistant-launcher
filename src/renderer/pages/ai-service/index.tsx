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
import {
  ActionName,
  containerNameDict,
  ServiceName,
} from '../../../main/podman-desktop/type-info';
import {
  ActionName as CmdActionName,
  ServiceName as CmdServiceName,
  channel as cmdChannel,
} from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';

interface ContainerItem {
  name: string;
  serviceName: ServiceName;
  state: '还未安装' | '已经停止' | '正在运行';
  port: number;
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
  const { containers, action, loading, initing } = useDocker();
  const {
    isInstallWSL,
    checkingWsl,
    action: cmdAction,
    loading: cmdLoading,
  } = useCmd();
  const [showRebootModal, setShowRebootModal] = useState(false);
  const [operating, setOperating] = useState<{
    serviceName: ServiceName;
    actionName: ActionName;
  }>({
    serviceName: 'LLM',
    actionName: 'install',
  });
  const [cmdOperating, setCmdOperating] = useState<{
    serviceName: CmdServiceName;
    actionName: CmdActionName;
  }>({
    serviceName: 'WSL',
    actionName: 'install',
  });
  const llmContainer = containers.filter(
    (item) => item.Names.indexOf(containerNameDict.LLM) >= 0,
  )[0];
  const ttsContainer = containers.filter(
    (item) => item.Names.indexOf(containerNameDict.TTS) >= 0,
  )[0];
  const asrContainer = containers.filter(
    (item) => item.Names.indexOf(containerNameDict.ASR) >= 0,
  )[0];

  const containerInfos: ContainerItem[] = [
    // {
    //   name: '对话机器人',
    //   serviceName: 'LLM',
    //   state: getState(llmContainer),
    //   port: 3000,
    // },
    {
      name: '语音转文字',
      serviceName: 'ASR',
      state: getState(asrContainer),
      port: 9000,
    },
    {
      name: '文字转语音',
      serviceName: 'TTS',
      state: getState(ttsContainer),
      port: 8000,
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

  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      cmdChannel,
      (messageType: MESSAGE_TYPE, data: any) => {
        if (messageType === MESSAGE_TYPE.DATA) {
          const {
            action: actionName,
            service,
            data: success,
          } = data as MessageData<CmdActionName, CmdServiceName, boolean>;
          if (actionName === 'install' && service === 'WSL') {
            if (success) {
              setShowRebootModal(true);
            }
          }
        }
      },
    );

    return () => {
      cancel();
    };
  }, [setShowRebootModal]);

  return (
    <div className="ai-service">
      <Modal open={showRebootModal} footer={false} closable={false}>
        已经成功打开windows系统自带WSL组件，需要重启电脑才能进行后续操作，请确保你保存了所有的文件后手动重启电脑
      </Modal>
      <List
        className="ai-service-list"
        header={
          <div className="header-container">
            <Link to="/hello">
              <Button disabled={loading || cmdLoading}>返回</Button>
            </Link>
            <div>
              <Popconfirm
                title="搬迁安装位置"
                description="搬迁安装位置时，会自动停止所有服务，搬迁完成后请手动启动服务"
                onConfirm={() => clickCmd('move', 'podman')}
                okText="确认搬迁"
                cancelText="不搬迁"
              >
                <Button
                  disabled={!isInstallWSL || cmdLoading || loading}
                  type="primary"
                  shape="round"
                  danger
                  loading={
                    cmdLoading &&
                    cmdOperating.serviceName === 'podman' &&
                    cmdOperating.actionName === 'move'
                  }
                >
                  搬迁安装位置
                </Button>
              </Popconfirm>
              <div style={{ width: '20px', display: 'inline-block' }}></div>
              <Popconfirm
                title="删除所有服务和缓存"
                description="你确定要删除所有服务和缓存吗？删除后再次安装会需要很长时间！"
                onConfirm={() => clickCmd('remove', 'podman')}
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
                    cmdOperating.serviceName === 'podman' &&
                    cmdOperating.actionName === 'remove'
                  }
                >
                  删除所有服务和缓存
                </Button>
              </Popconfirm>
              <div style={{ width: '20px', display: 'inline-block' }}></div>
              <Button
                disabled={isInstallWSL}
                type="primary"
                shape="round"
                loading={
                  checkingWsl ||
                  (cmdLoading &&
                    cmdOperating.serviceName === 'WSL' &&
                    cmdOperating.actionName === 'install')
                }
                onClick={() => clickCmd('install', 'WSL')}
              >
                {checkingWsl
                  ? '正在检查WSL安装状态'
                  : isInstallWSL
                    ? '已启用Windows自带的WSL组件'
                    : '开启本地AI服务前请点我启用Windows自带的WSL组件'}
              </Button>
            </div>
          </div>
        }
        bordered
        dataSource={containerInfos}
        renderItem={(item) => (
          <List.Item
            actions={[
              `访问地址：http://127.0.0.1:${item.port}`,
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
              item.state === '正在运行' && (
                <Button
                  shape="round"
                  size="small"
                  disabled={!isInstallWSL || checkingWsl || cmdLoading}
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
                  disabled={!isInstallWSL || checkingWsl || cmdLoading}
                  loading={
                    loading &&
                    operating.serviceName === item.serviceName &&
                    operating.actionName === 'start'
                  }
                  type="primary"
                  onClick={() => click('start', item.serviceName)}
                >
                  启动
                </Button>
              ),
              item.state === '已经停止' && (
                <Popconfirm
                  title="删除容器"
                  description="你确定要删除容器？删除后再次安装会需要较长时间！"
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
