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
import { useEffect, useState } from 'react';
import useDocker from '../../containers/use-docker';
import {
  ActionName,
  channel,
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
import ContainerLogs from '../../containers/container-logs';
import {
  ContainerItem,
  getState,
} from '../../containers/use-training-service-shortcut';

export default function TrainingService() {
  const [dockerDatatrigger, setDockerDataTrigger] = useState(1);
  const { containers, action, loading, initing } = useDocker(dockerDatatrigger);
  const {
    isInstallWSL,
    wslVersion,
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

  if (containerInfos.filter((item) => item.state === '正在启动').length > 0) {
    setTimeout(() => setDockerDataTrigger(dockerDatatrigger + 1), 1000);
  }

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
                title="升级WSL"
                description={
                  <div>
                    <div>您当前的WSL版本是</div>
                    <div>{wslVersion}</div>
                    <div>确认升级WSL吗？</div>
                  </div>
                }
                onConfirm={() => clickCmd('update', 'WSL')}
                okText="升级"
                cancelText="不升级"
              >
                <Button
                  disabled={!isInstallWSL || cmdLoading || loading}
                  shape="round"
                  loading={
                    cmdLoading &&
                    cmdOperating.serviceName === 'WSL' &&
                    cmdOperating.actionName === 'update'
                  }
                >
                  升级WSL
                </Button>
              </Popconfirm>
              <div style={{ width: '20px', display: 'inline-block' }}></div>
              <Popconfirm
                title="修改安装位置"
                description={
                  <div>
                    <div>
                      修改安装位可能需要5分钟时间，实际用时和你的磁盘读写速度有关。
                    </div>
                    <div style={{ color: 'red' }}>
                      提示Docker用户：如果您的电脑上还有Docker软件，请您先手动关闭Docker软件前台和后台程序以避免Docker文件被损坏。搬迁完成后如果出现无法正常运行Docker的情况，请您重启电脑后再打开Docker。
                    </div>
                  </div>
                }
                onConfirm={() => clickCmd('move', 'podman')}
                okText="修改"
                cancelText="不修改"
              >
                <Button
                  disabled={!isInstallWSL || cmdLoading || loading}
                  shape="round"
                  loading={
                    cmdLoading &&
                    cmdOperating.serviceName === 'podman' &&
                    cmdOperating.actionName === 'move'
                  }
                >
                  修改安装位置
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
              item.serviceName === 'TRAINING' && item.state === '正在运行' ? (
                <Button
                  shape="round"
                  size="small"
                  type="primary"
                  disabled={
                    !isInstallWSL || checkingWsl || loading || cmdLoading
                  }
                  onClick={window.mainHandle.startTrainingServiceHandle}
                >
                  开始学习
                </Button>
              ) : null,
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
              (item.state === '已经停止' || item.state === '正在启动') && (
                // (item.serviceName === 'TTS' || item.state === '已经停止') && (
                <Button
                  shape="round"
                  size="small"
                  disabled={!isInstallWSL || checkingWsl || cmdLoading}
                  loading={
                    (loading &&
                      operating.serviceName === item.serviceName &&
                      operating.actionName === 'start') ||
                    item.state === '正在启动'
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
                  description="未备份时,删除会导致学习进度丢失,你确定要删除吗?"
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
      <div className="container-log-box">
        <ContainerLogs serviceName="TRAINING" />
      </div>
    </div>
  );
}

