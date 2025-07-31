import { Button, List, notification, Popconfirm, Typography } from 'antd';
import { Link } from 'react-router-dom';
import './index.scss';
import { useState } from 'react';
import {
  ActionName,
  LMModel,
  lmStudioServiceNameList,
  modelNameDict,
  ServerStatus,
  ServiceName,
} from '../../../main/lm-studio/type-info';
import {
  ActionName as CmdActionName,
  ServiceName as CmdServiceName,
} from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import useLMStudio from '../../containers/use-lm-studio';

interface ModelItem {
  name: string;
  serviceName: ServiceName;
  state: '还未安装' | '已经安装' | '已经加载';
}

function getState(
  lMModel?: LMModel,
  lmServerStatus?: ServerStatus,
): ModelItem['state'] {
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

  const modelInfos: ModelItem[] = lmStudioServiceNameList.map((serviceName) => {
    const lmsInfo = lMModels.filter(
      (item) => item.displayName === modelNameDict[serviceName],
    )[0];
    return {
      name: lmsInfo ? lmsInfo.modelKey : serviceName,
      serviceName: serviceName,
      state: getState(lmsInfo, lmServerStatus),
    };
  });

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
            key={item.serviceName}
            actions={[
              `http://127.0.0.1:${lmServerStatus.port}`,
              item.state === '已经加载' && (
                <Button
                  shape="round"
                  size="small"
                  disabled={
                    !isInstallWSL ||
                    checkingWsl ||
                    cmdLoading ||
                    !isInstallLMStudio
                  }
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
                  disabled={
                    !isInstallWSL ||
                    checkingWsl ||
                    cmdLoading ||
                    !isInstallLMStudio
                  }
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
                  title="删除模型"
                  description="请使用LM Studio软件进行删除模型的操作"
                  okText="知道了"
                >
                  <Button
                    shape="round"
                    size="small"
                    disabled={
                      !isInstallWSL ||
                      checkingWsl ||
                      cmdLoading ||
                      !isInstallLMStudio
                    }
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
                  disabled={
                    !isInstallWSL ||
                    checkingWsl ||
                    cmdLoading ||
                    !isInstallLMStudio
                  }
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
