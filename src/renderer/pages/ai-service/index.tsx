import { Button, List, Modal, notification, Typography, Switch, Card, Collapse, Tag } from 'antd';
import { Link } from 'react-router-dom';
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
import useServiceControl from '../../containers/use-service-control';
import useServiceLogs from '../../containers/use-service-logs';

const { Panel } = Collapse;

// 判断是否为开发环境
const isDevelopment = process.env.NODE_ENV === 'development';

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
  const { isInstallWSL, action: cmdAction, loading: cmdLoading } = useCmd();
  const { toggleService, getServiceState } = useServiceControl();
  const { logs, isLogsVisible, addLog, clearLogs, toggleLogsVisibility } = useServiceLogs();
  
  const [showRebootModal, setShowRebootModal] = useState(false);
  const [operating, setOperating] = useState<{
    serviceName: ServiceName;
    actionName: ActionName;
  }>({
    serviceName: 'ASR', // 改为ASR，因为LLM暂时不可用
    actionName: 'install',
  });
  const [cmdOperating, setCmdOperating] = useState<{
    serviceName: CmdServiceName;
    actionName: CmdActionName;
  }>({
    serviceName: 'WSL',
    actionName: 'install',
  });
  
  // 暂时注释掉LLM相关容器，因为没有后端支持
  // const llmContainer = containers.filter(
  //   (item) => item.Names.indexOf(containerNameDict.LLM) >= 0,
  // )[0];
  const ttsContainer = containers.filter(
    (item) => item.Names.indexOf(containerNameDict.TTS) >= 0,
  )[0];
  const asrContainer = containers.filter(
    (item) => item.Names.indexOf(containerNameDict.ASR) >= 0,
  )[0];

  const containerInfos: ContainerItem[] = [
    // 暂时注释掉LLM服务，因为没有后端支持
    // {
    //   name: '对话机器人',
    //   serviceName: 'LLM',
    //   state: getState(llmContainer),
    // },
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

  // 处理服务开关切换
  const handleServiceToggle = async (serviceName: ServiceName, checked: boolean) => {
    try {
      // 只在开发环境下记录日志
      if (isDevelopment) {
        addLog('info', serviceName, `开始${checked ? '启动' : '停止'}服务...`);
      }
      const newState = await toggleService(serviceName);
      if (isDevelopment) {
        addLog('success', serviceName, `服务${newState ? '启动' : '停止'}成功`);
      }
      notification.success({
        message: `${containerInfos.find(item => item.serviceName === serviceName)?.name} ${newState ? '启动' : '停止'}成功`,
        placement: 'topRight',
      });
    } catch (error) {
      if (isDevelopment) {
        addLog('error', serviceName, `服务操作失败: ${error}`);
      }
      notification.error({
        message: `服务操作失败`,
        description: `${error}`,
        placement: 'topRight',
      });
    }
  };

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

  // 监听容器安装日志
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      'service-logs',
      (logData: any) => {
        // 只在开发环境下显示日志
        if (isDevelopment && logData.level && logData.service && logData.message) {
          addLog(logData.level, logData.service, logData.message);
        }
      },
    );

    return () => {
      cancel();
    };
  }, [addLog]);

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
              <Button>返回</Button>
            </Link>
            <Button
              disabled={isInstallWSL}
              type="primary"
              shape="round"
              loading={
                cmdLoading &&
                cmdOperating.serviceName === 'WSL' &&
                cmdOperating.actionName === 'install'
              }
              onClick={() => clickCmd('install', 'WSL')}
            >
              {isInstallWSL
                ? '已启用Windows自带的WSL组件'
                : '开启本地AI服务前请点我启用Windows自带的WSL组件'}
            </Button>
          </div>
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
                  disabled={!isInstallWSL}
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
                  disabled={!isInstallWSL}
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
                  disabled={!isInstallWSL}
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
                  disabled={!isInstallWSL}
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
                  disabled={!isInstallWSL}
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

      {/* 服务控制区域 */}
      <Card className="service-control-card" title="容器服务控制" size="small">
        <div className="service-switches">
          {containerInfos.map((item) => {
            const serviceState = getServiceState(item.serviceName);
            return (
              <div key={item.serviceName} className="service-switch-item">
                <span className="service-name">{item.name}</span>
                <Switch
                  checked={serviceState.isEnabled}
                  loading={serviceState.isOperating}
                  disabled={!isInstallWSL}
                  onChange={(checked) => handleServiceToggle(item.serviceName, checked)}
                />
                <Tag color={serviceState.isEnabled ? 'green' : 'default'}>
                  {serviceState.isEnabled ? '运行中' : '已停止'}
                </Tag>
              </div>
            );
          })}
        </div>
        <div className="control-actions">
          {/* 只在开发环境下显示日志控制按钮 */}
          {isDevelopment && (
            <>
              <Button 
                size="small" 
                onClick={toggleLogsVisibility}
                type={isLogsVisible ? 'primary' : 'default'}
              >
                {isLogsVisible ? '隐藏日志' : '查看日志'}
              </Button>
              <Button size="small" onClick={clearLogs}>
                清空日志
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* 日志输出区域 - 只在开发环境下显示 */}
      {isDevelopment && isLogsVisible && (
        <Card className="logs-card" title={`服务日志 (${logs.length}条)`} size="small">
          <div className="logs-container">
            {logs.length === 0 ? (
              <div className="no-logs">暂无日志</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={`log-entry log-${log.level}`}>
                  <span className="log-timestamp">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <Tag color={
                    log.level === 'error' ? 'red' :
                    log.level === 'warning' ? 'orange' :
                    log.level === 'success' ? 'green' : 'blue'
                  }>
                    {log.service}
                  </Tag>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
