import {
  Button,
  List,
  message,
  notification,
  Popconfirm,
  Progress,
  Typography,
} from 'antd';
import { Link } from 'react-router-dom';
import './index.scss';
import { useEffect, useState } from 'react';
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

  // LM Studio P2P 下载状态
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloadComplete, setIsDownloadComplete] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [lmStudioMagnet, setLmStudioMagnet] = useState<string | null>(null);

  useEffect(() => {
    checkLMStudioUpdate();
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (downloading && !isDownloadComplete) {
        updateDownloadProgress();
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [downloading, isDownloadComplete]);

  const checkLMStudioUpdate = async () => {
    // 检查是否已经有下载完成的文件，或正在下载中（用于恢复后台下载状态）
    try {
      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const lmStudioDLC = dlcIndex.find(
        (item) => item.id === 'LM_STUDIO_SETUP_EXE',
      );
      if (lmStudioDLC) {
        const version = Object.keys(lmStudioDLC.versions).sort().pop();
        if (version) {
          setLatestVersion(version);
          const versionInfo = lmStudioDLC.versions[version];
          if (versionInfo.progress) {
            const progress = versionInfo.progress.progress || 0;
            if (progress >= 1) {
              // 下载已完成
              setIsDownloadComplete(true);
              setDownloadProgress(100);
              setDownloading(false);
            } else if (progress > 0) {
              // 正在下载中，恢复下载状态
              setDownloading(true);
              setDownloadProgress(Math.floor(progress * 100));
              setLmStudioMagnet(versionInfo.magnet);
              setIsDownloadComplete(false);
            }
          }
        }
      }
    } catch (error) {
      console.error('检查LM Studio下载状态失败:', error);
    }
  };

  const updateDownloadProgress = async () => {
    try {
      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const lmStudioDLC = dlcIndex.find(
        (item) => item.id === 'LM_STUDIO_SETUP_EXE',
      );
      if (lmStudioDLC) {
        const version = Object.keys(lmStudioDLC.versions).sort().pop();
        if (version) {
          const versionInfo = lmStudioDLC.versions[version];
          if (versionInfo.progress) {
            const progress = versionInfo.progress.progress || 0;
            setDownloadProgress(Math.floor(progress * 100));
            if (progress >= 1) {
              setDownloading(false);
              setIsDownloadComplete(true);
              message.success('LM Studio下载完成，可以点击安装按钮进行安装');
            }
          }
        }
      }
    } catch (error) {
      console.error('获取LM Studio下载进度失败:', error);
    }
  };

  const handleDownloadOrInstallLMStudio = async () => {
    // 如果已经下载完成，直接安装
    if (isDownloadComplete) {
      clickCmd('install', 'lm-studio');
      return;
    }

    // 否则开始下载
    try {
      setDownloading(true);
      setDownloadProgress(0);
      message.info('正在启动下载LM Studio...');

      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const lmStudioDLC = dlcIndex.find(
        (item) => item.id === 'LM_STUDIO_SETUP_EXE',
      );

      if (!lmStudioDLC) {
        throw new Error('未找到LM Studio安装包信息');
      }

      const version = Object.keys(lmStudioDLC.versions).sort().pop();
      if (!version) {
        throw new Error('未找到可用版本');
      }

      setLatestVersion(version);
      const versionInfo = lmStudioDLC.versions[version];
      const magnet = versionInfo.magnet;
      setLmStudioMagnet(magnet);

      const result = await window.mainHandle.startWebtorrentHandle(magnet);
      if (result.success) {
        message.success(`开始下载LM Studio ${version}`);
      } else {
        throw new Error('error' in result ? result.error : '启动下载失败');
      }
    } catch (error) {
      console.error('下载LM Studio失败:', error);
      message.error('下载失败：' + (error as Error).message);
      setDownloading(false);
      setLmStudioMagnet(null);
    }
  };

  const handleCancelLMStudioDownload = async () => {
    if (!lmStudioMagnet) {
      message.warning('没有正在进行的下载');
      return;
    }
    try {
      await window.mainHandle.pauseWebtorrentHandle(lmStudioMagnet);
      setDownloading(false);
      setDownloadProgress(0);
      setLmStudioMagnet(null);
      message.info('已取消下载');
    } catch (error) {
      console.error('取消下载失败:', error);
      message.error('取消下载失败');
    }
  };
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
              <Link to="/llm-api-config">
                <Button
                  type="primary"
                  shape="round"
                  style={{ marginRight: '20px' }}
                >
                  大模型API配置
                </Button>
              </Link>
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
              {/* 更新/安装 LM Studio */}
              {isInstallLMStudio ? (
                <Button type="primary" shape="round" disabled>
                  已安装LMStudio
                </Button>
              ) : (
                <div
                  className={`download-wrapper ${
                    downloading ? 'downloading' : ''
                  } ${isDownloadComplete ? 'download-complete' : ''}`}
                >
                  {downloading && !isDownloadComplete && (
                    <Progress
                      type="circle"
                      percent={Math.round(downloadProgress)}
                      size={28}
                      strokeWidth={10}
                      strokeColor="#1677ff"
                    />
                  )}
                  {downloading && !isDownloadComplete ? (
                    <Button
                      shape="round"
                      danger
                      onClick={handleCancelLMStudioDownload}
                    >
                      取消下载
                    </Button>
                  ) : (
                    <Button
                      type={isDownloadComplete ? 'primary' : 'default'}
                      shape="round"
                      className={
                        isDownloadComplete ? 'download-complete-btn' : ''
                      }
                      loading={
                        checkingWsl ||
                        (cmdLoading &&
                          cmdOperating.serviceName === 'lm-studio' &&
                          cmdOperating.actionName === 'install')
                      }
                      disabled={checkingWsl}
                      onClick={handleDownloadOrInstallLMStudio}
                    >
                      {checkingWsl
                        ? '检测安装状态...'
                        : isDownloadComplete
                          ? `安装 ${latestVersion || ''}`
                          : '下载并安装LMStudio'}
                    </Button>
                  )}
                </div>
              )}
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
              `http://127.0.0.1:${lmServerStatus.port}/v1`,
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
          >
            <Typography.Text type="success">[{item.state}]</Typography.Text>
            {item.name}
          </List.Item>,
        ]}
      />
      <TerminalLogScreen
        id="terminal-log"
        cols={100}
        rows={3}
        style={{ width: 'calc(100% - 20px)' }}
      />
    </div>
  );
}
