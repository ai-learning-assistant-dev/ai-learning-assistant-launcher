import { useCallback, useEffect, useState } from 'react';
import { Button, List, Skeleton, message, Progress } from 'antd';
import { Link, NavLink } from 'react-router-dom';
import './index.scss';
import useCmd from '../../containers/use-cmd';
import useConfigs from '../../containers/use-configs';
import { useObsidianVoiceService } from '../../containers/use-obsidian-voice-service';

export default function ObsidianApp() {
  const { isInstallObsidian, action: cmdAction } = useCmd();
  const {
    obsidianConfig,
    obsidianVaultConfig,
    action: configsAction,
  } = useConfigs();

  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloadComplete, setIsDownloadComplete] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState(0);

  const OBSIDIAN_VERSION = '1.12.4'; // 默认版本号，实际版本从文件名获取
  // Obsidian HTTPS 下载源列表（按优先级排序）
  const OBSIDIAN_DOWNLOAD_URLS = [
    `https://kkgithub.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/Obsidian-${OBSIDIAN_VERSION}.exe`,
    `https://gh-proxy.org/https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/Obsidian-${OBSIDIAN_VERSION}.exe`,
    `https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/Obsidian-${OBSIDIAN_VERSION}.exe`,
  ];

  // 从 Obsidian 文件名中提取版本号
  // 文件名格式: Obsidian-1.12.4.exe -> 提取 1.12.4
  const extractVersionFromFilename = (
    filePath: string | null,
  ): string | null => {
    if (!filePath) return null;
    const filename = filePath.split(/[/\\]/).pop() || '';
    const match = filename.match(/Obsidian-(\d+\.\d+\.\d+)/i);
    return match ? match[1] : null;
  };

  useEffect(() => {
    checkObsidianUpdate();
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (downloading && !isDownloadComplete) {
        updateDownloadProgress();
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [downloading, isDownloadComplete]);

  const checkObsidianUpdate = async () => {
    // 检查是否已经有下载完成的文件，或正在下载中（用于恢复后台下载状态）
    try {
      // 首先检查本地是否已有下载好的文件
      const fileCheck = await window.mainHandle.checkHttpsDownloadFileHandle(
        'OBSIDIAN_SETUP_EXE',
        OBSIDIAN_VERSION,
      );

      if (fileCheck.exists) {
        // 本地已有下载好的文件，从文件名提取版本号
        console.debug('Obsidian 安装包已存在:', fileCheck.filePath);
        const extractedVersion = extractVersionFromFilename(fileCheck.filePath);
        setLatestVersion(extractedVersion || OBSIDIAN_VERSION);
        setIsDownloadComplete(true);
        setDownloadProgress(100);
        setDownloading(false);
        return;
      }

      // 检查下载状态
      const httpsState = await window.mainHandle.queryHttpsDownloadHandle();
      const obsidianState = httpsState['OBSIDIAN_SETUP_EXE'];

      if (obsidianState) {
        if (
          obsidianState.status === 'completed' ||
          obsidianState.progress >= 1
        ) {
          // 下载已完成，从文件名提取版本号
          const extractedVersion = extractVersionFromFilename(
            obsidianState.filePath || null,
          );
          setLatestVersion(extractedVersion || OBSIDIAN_VERSION);
          setIsDownloadComplete(true);
          setDownloadProgress(100);
          setDownloading(false);
        } else if (
          obsidianState.status === 'downloading' &&
          obsidianState.progress > 0
        ) {
          // 正在下载中，恢复下载状态
          setDownloading(true);
          setDownloadProgress(Math.floor(obsidianState.progress * 100));
          setDownloadSpeed(obsidianState.speed || 0);
          setIsDownloadComplete(false);
        }
      }
    } catch (error) {
      console.error('检查Obsidian下载状态失败:', error);
    }
  };

  const updateDownloadProgress = async () => {
    try {
      const httpsState = await window.mainHandle.queryHttpsDownloadHandle();
      const obsidianState = httpsState['OBSIDIAN_SETUP_EXE'];

      if (obsidianState) {
        const progress = obsidianState.progress || 0;
        setDownloadProgress(Math.floor(progress * 100));
        setDownloadSpeed(obsidianState.speed || 0);

        if (obsidianState.status === 'completed' || progress >= 1) {
          // 下载完成，从文件名提取版本号
          const extractedVersion = extractVersionFromFilename(
            obsidianState.filePath || null,
          );
          setLatestVersion(extractedVersion || OBSIDIAN_VERSION);
          setDownloading(false);
          setIsDownloadComplete(true);
          message.success('Obsidian下载完成，可以点击安装按钮进行安装');
        } else if (obsidianState.status === 'error') {
          setDownloading(false);
          message.error('下载失败：' + (obsidianState.error || '未知错误'));
        }
      }
    } catch (error) {
      console.error('获取Obsidian下载进度失败:', error);
    }
  };

  const handleDownloadOrInstall = async () => {
    // 如果已经下载完成，直接安装
    if (isDownloadComplete) {
      handleInstallObsidian();
      return;
    }

    // 否则开始 HTTPS 多源下载
    try {
      setDownloading(true);
      setDownloadProgress(0);
      setDownloadSpeed(0);
      message.info('正在启动下载Obsidian...');

      const version = latestVersion || OBSIDIAN_VERSION;
      setLatestVersion(version);

      const result = await window.mainHandle.startHttpsDownloadHandle(
        'OBSIDIAN_SETUP_EXE',
        OBSIDIAN_DOWNLOAD_URLS,
        version,
      );

      if (result.success) {
        message.success(`开始下载Obsidian ${version}`);
      } else {
        throw new Error(result.error || '启动下载失败');
      }
    } catch (error) {
      console.error('下载Obsidian失败:', error);
      message.error('下载失败：' + (error as Error).message);
      setDownloading(false);
    }
  };

  const handleCancelDownload = async () => {
    if (!downloading) {
      message.warning('没有正在进行的下载');
      return;
    }
    try {
      await window.mainHandle.cancelHttpsDownloadHandle('OBSIDIAN_SETUP_EXE');
      setDownloading(false);
      setDownloadProgress(0);
      setDownloadSpeed(0);
      message.info('已取消下载');
    } catch (error) {
      console.error('取消下载失败:', error);
      message.error('取消下载失败');
    }
  };

  const handleInstallObsidian = async () => {
    try {
      message.info('正在打开安装程序...');
      cmdAction('install', 'obsidianApp');
    } catch (error) {
      console.error('打开安装程序失败:', error);
      message.error('失败：' + (error as Error).message);
    }
  };

  return (
    <div className="obsidian-app">
      <List
        className="obsidian-app-list"
        header={
          <div className="header-container">
            <NavLink to="/hello">
              <Button>返回</Button>
            </NavLink>
          </div>
        }
        bordered
      >
        {obsidianVaultConfig?.map((vault) => (
          <List.Item
            key={vault.id}
            actions={[
              <NavLink key="workspace" to={`/workspace-manage/${vault.id}`}>
                <Button>工作区管理</Button>
              </NavLink>,
              <NavLink key={0} to={`/obsidian-plugin/${vault.id}`}>
                <Button>插件情况</Button>
              </NavLink>,
              isInstallObsidian && (
                <Button
                  key={1}
                  onClick={() => cmdAction('start', 'obsidianApp', vault.id)}
                >
                  用阅读器打开
                </Button>
              ),
            ].filter((item) => item)}
          >
            <List.Item.Meta
              title={`仓库 ${vault.name}`}
              description={vault.path}
            />
          </List.Item>
        ))}
        <List.Item
          actions={[
            !isInstallObsidian && (
              <div
                key="download"
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
                  <Button shape="round" danger onClick={handleCancelDownload}>
                    取消下载
                  </Button>
                ) : (
                  <Button
                    type={isDownloadComplete ? 'primary' : 'default'}
                    shape="round"
                    className={
                      isDownloadComplete ? 'download-complete-btn' : ''
                    }
                    loading={false}
                    onClick={handleDownloadOrInstall}
                  >
                    {isDownloadComplete
                      ? `安装 ${latestVersion || ''}`
                      : '更新Obsidian'}
                  </Button>
                )}
              </div>
            ),
            <Button
              key="locate"
              onClick={() => configsAction('update', 'obsidianApp')}
            >
              {isInstallObsidian ? '重新定位Obsidian' : '定位Obsidian'}
            </Button>,
            isInstallObsidian && (
              <Button
                key="run"
                type="primary"
                onClick={() => cmdAction('start', 'obsidianApp')}
              >
                运行Obsidian
              </Button>
            ),
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title="Obsidian主程序"
            description={obsidianConfig?.obsidianApp?.bin || '未安装'}
          />
        </List.Item>
        {/* 老版本兼容 - 直接安装 */}
        {/* 老版本兼容 - 直接安装 */}
        <List.Item
          actions={[
            !isInstallObsidian && (
              <Button
                key={0}
                onClick={() => cmdAction('install', 'obsidianApp')}
              >
                本地安装
              </Button>
            ),
          ].filter((item) => item)}
        >
          <List.Item.Meta
            title="使用本地安装包"
            description="如果您已经下载了Obsidian安装包，可以直接使用本地安装"
          />
        </List.Item>
      </List>
    </div>
  );
}
