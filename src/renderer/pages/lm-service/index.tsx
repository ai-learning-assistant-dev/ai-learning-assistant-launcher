import { Button, List, notification, Popconfirm, Typography, Modal, Descriptions } from 'antd';
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
import demoPic from './demo.png';
import { TerminalLogScreen } from '../../containers/terminal-log-screen';

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

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) {
    return '未知';
  }
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatParameterCount(count?: number): string {
  if (count === undefined || count === null) {
    return '未知';
  }
  if (count >= 1000000000) {
    return (count / 1000000000).toFixed(1) + 'B';
  } else if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  } else if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  } else {
    return count.toString();
  }
}

export default function LMService() {
  const { lmServerStatus, lMModels, action, loading, initing } = useLMStudio();
  const {
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
  const [showDetail, setShowDetail] = useState(false);
  const [selectedModel, setSelectedModel] = useState<LMModel | null>(null);
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
              <Popconfirm
                title="修改模型存储位置的方法"
                description={
                  <div>
                    <div>请打开LM Studio软件后按照下图所示操作</div>
                    <div
                      className="lm-studio-demo"
                      style={{
                        backgroundImage: `url(${demoPic})`,
                      }}
                    ></div>
                  </div>
                }
                okText="我知道了"
              >
                <Button
                  disabled={cmdLoading || loading}
                  type="primary"
                  shape="round"
                  danger
                >
                  修改模型存储位置
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
        renderItem={(item) => [
          item.serviceName === 'qwen/qwen3-4b' && (
            <List.Item key={`block_title_${item.serviceName}`}>
              <Typography.Text strong>语言模型：</Typography.Text>
            </List.Item>
          ),
          item.serviceName === 'qwen/qwen3-embedding-0.6b' && (
            <List.Item key={`block_title_${item.serviceName}`}>
              <Typography.Text strong>词嵌入模型：</Typography.Text>
            </List.Item>
          ),
          <List.Item
            key={item.serviceName}
            actions={[
              (item.state === '已经安装' || item.state === '已经加载') &&
              <Button
                shape="round"
                size="small"
                onClick={() => {
                  const model = lMModels.find(
                    (m) => m.modelKey === item.name || m.displayName === modelNameDict[item.serviceName]
                  );
                  if (model) {
                    setSelectedModel(model);
                  } else {
                    // 创建一个临时的模型对象用于显示
                    setSelectedModel({
                      modelKey: item.name,
                      displayName: modelNameDict[item.serviceName],
                      isLoaded: item.state === '已经加载',
                      port: lmServerStatus.port,
                      type: '',
                      format: '',
                      path: '',
                      sizeBytes: 0,
                      architecture: '',
                      maxContextLength: 0,
                    } as LMModel);
                  }
                  setShowDetail(true);
                }}
              >
                详情
              </Button>,
              item.state === '已经加载' && (
                <Button
                  shape="round"
                  size="small"
                  disabled={checkingWsl || cmdLoading || !isInstallLMStudio}
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
                  disabled={checkingWsl || cmdLoading || !isInstallLMStudio}
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
                    disabled={checkingWsl || cmdLoading || !isInstallLMStudio}
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
                  disabled={checkingWsl || cmdLoading || !isInstallLMStudio}
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
            className="model-list-item"
          >
            <div>
              <Typography.Text type={
                item.state === '已经加载' ? 'success' :
                  item.state === '已经安装' ? 'success' :
                    'secondary'
              }>
                [{item.state}]
              </Typography.Text>
              <Typography.Text className="model-name">
                {item.name}
              </Typography.Text>
            </div>
            <Typography.Text className="service-address">
              服务地址: <span className="service-url">http://127.0.0.1:{lmServerStatus.port}</span>
            </Typography.Text>
          </List.Item>,
        ]}
      />
      <TerminalLogScreen
        id="terminal-log"
        cols={100}
        rows={3}
        style={{ width: 'calc(100% - 20px)' }}
      />
      <Modal
        open={showDetail}
        title="模型信息"
        onCancel={() => setShowDetail(false)}
        footer={null}
        width="70%"
        style={{ maxWidth: 720, minWidth: 300 }}
      >
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="名称">
            {selectedModel?.displayName || selectedModel?.modelKey || '未知'}
          </Descriptions.Item>
          <Descriptions.Item label="大小">
            {formatBytes(selectedModel?.sizeBytes)}
          </Descriptions.Item>
          <Descriptions.Item label="参数量">
            {formatParameterCount(selectedModel?.parameterCount)}
          </Descriptions.Item>
          <Descriptions.Item label="路径">
            {selectedModel?.path || '未知'}
          </Descriptions.Item>
          <Descriptions.Item label="格式">
            {selectedModel?.format || '未知'}
          </Descriptions.Item>
          {/* <Descriptions.Item label="架构">
            {selectedModel?.architecture || '未知'}
          </Descriptions.Item> */}
          <Descriptions.Item label="上下文长度">
            {selectedModel?.maxContextLength ?? '未知'}
          </Descriptions.Item>
          <Descriptions.Item label="唯一标识">
            {selectedModel?.modelKey || '未知'}
          </Descriptions.Item>
          {/* <Descriptions.Item label="加载状态">
            {selectedModel?.isLoaded ? '已加载' : '未加载'}
          </Descriptions.Item> */}
          <Descriptions.Item label="服务地址">
            {`http://127.0.0.1:${lmServerStatus.port}`}
          </Descriptions.Item>
        </Descriptions>
      </Modal>
    </div>
  );
}
