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

  // LM Studio HTTPS 下载状态
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloadComplete, setIsDownloadComplete] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState(0);

  // LM Studio 下载源列表（按优先级排序）
  const LM_STUDIO_DOWNLOAD_URLS = [
    'https://lm-studio.cn/download/latest/win32/x64',
    'https://lmstudio.ai/download/latest/win32/x64',
  ];
  const LM_STUDIO_VERSION = '0.3.15'; // 默认版本号，实际版本从文件名获取

  // 从 LM Studio 文件名中提取版本号
  // 文件名格式: LM-Studio-0.4.7-4-x64.exe -> 提取 0.4.7
  const extractVersionFromFilename = (
    filePath: string | null,
  ): string | null => {
    if (!filePath) return null;
    const filename = filePath.split(/[/\\]/).pop() || '';
    const match = filename.match(/LM-Studio-(\d+\.\d+\.\d+)/i);
    return match ? match[1] : null;
  };

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
      // 首先检查本地是否已有下载好的文件
      const fileCheck = await window.mainHandle.checkHttpsDownloadFileHandle(
        'LM_STUDIO_SETUP_EXE',
        LM_STUDIO_VERSION,
      );

      if (fileCheck.exists) {
        // 本地已有下载好的文件，从文件名提取版本号
        console.debug('LM Studio 安装包已存在:', fileCheck.filePath);
        const extractedVersion = extractVersionFromFilename(fileCheck.filePath);
        setLatestVersion(extractedVersion || LM_STUDIO_VERSION);
        setIsDownloadComplete(true);
        setDownloadProgress(100);
        setDownloading(false);
        return;
      }

      // 检查下载状态
      const httpsState = await window.mainHandle.queryHttpsDownloadHandle();
      const lmStudioState = httpsState['LM_STUDIO_SETUP_EXE'];

      if (lmStudioState) {
        if (
          lmStudioState.status === 'completed' ||
          lmStudioState.progress >= 1
        ) {
          // 下载已完成，从文件名提取版本号
          const extractedVersion = extractVersionFromFilename(
            lmStudioState.filePath || null,
          );
          setLatestVersion(extractedVersion || LM_STUDIO_VERSION);
          setIsDownloadComplete(true);
          setDownloadProgress(100);
          setDownloading(false);
        } else if (
          lmStudioState.status === 'downloading' &&
          lmStudioState.progress > 0
        ) {
          // 正在下载中，恢复下载状态
          setDownloading(true);
          setDownloadProgress(Math.floor(lmStudioState.progress * 100));
          setDownloadSpeed(lmStudioState.speed || 0);
          setIsDownloadComplete(false);
        }
      }
    } catch (error) {
      console.error('检查LM Studio下载状态失败:', error);
    }
  };

  const updateDownloadProgress = async () => {
    try {
      const httpsState = await window.mainHandle.queryHttpsDownloadHandle();
      const lmStudioState = httpsState['LM_STUDIO_SETUP_EXE'];

      if (lmStudioState) {
        const progress = lmStudioState.progress || 0;
        setDownloadProgress(Math.floor(progress * 100));
        setDownloadSpeed(lmStudioState.speed || 0);

        if (lmStudioState.status === 'completed' || progress >= 1) {
          // 下载完成，从文件名提取版本号
          const extractedVersion = extractVersionFromFilename(
            lmStudioState.filePath || null,
          );
          setLatestVersion(extractedVersion || LM_STUDIO_VERSION);
          setDownloading(false);
          setIsDownloadComplete(true);
          message.success('LM Studio下载完成，可以点击安装按钮进行安装');
        } else if (lmStudioState.status === 'error') {
          setDownloading(false);
          message.error('下载失败：' + (lmStudioState.error || '未知错误'));
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

    // 否则开始 HTTPS 多源下载
    try {
      setDownloading(true);
      setDownloadProgress(0);
      setDownloadSpeed(0);
      message.info('正在启动下载LM Studio...');

      const version = latestVersion || LM_STUDIO_VERSION;
      setLatestVersion(version);

      const result = await window.mainHandle.startHttpsDownloadHandle(
        'LM_STUDIO_SETUP_EXE',
        LM_STUDIO_DOWNLOAD_URLS,
        version,
      );

      if (result.success) {
        message.success(`开始下载LM Studio ${version}`);
      } else {
        throw new Error(result.error || '启动下载失败');
      }
    } catch (error) {
      console.error('下载LM Studio失败:', error);
      message.error('下载失败：' + (error as Error).message);
      setDownloading(false);
    }
  };

  const handleCancelLMStudioDownload = async () => {
    if (!downloading) {
      message.warning('没有正在进行的下载');
      return;
    }
    try {
      await window.mainHandle.cancelHttpsDownloadHandle('LM_STUDIO_SETUP_EXE');
      setDownloading(false);
      setDownloadProgress(0);
      setDownloadSpeed(0);
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
