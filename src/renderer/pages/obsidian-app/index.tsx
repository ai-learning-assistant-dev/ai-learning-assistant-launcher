import { useCallback, useEffect, useState } from 'react';
import { Button, List, Skeleton, message, Progress } from 'antd';
import { Link, NavLink } from 'react-router-dom';
import './index.scss';
import { channel } from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import useConfigs from '../../containers/use-configs';

export default function ObsidianApp() {
  const {
    isInstallObsidian,
    action: cmdAction,
    loading: cmdLoading,
  } = useCmd();
  const {
    obsidianConfig,
    obsidianVaultConfig,
    action: configsAction,
    loading: configsLoading,
  } = useConfigs();

  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloadComplete, setIsDownloadComplete] = useState(false);
  const [currentMagnet, setCurrentMagnet] = useState<string | null>(null);

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
      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const obsidianDLC = dlcIndex.find(
        (item) => item.id === 'OBSIDIAN_SETUP_EXE',
      );
      if (obsidianDLC) {
        const latestVersion = Object.keys(obsidianDLC.versions).sort().pop();
        if (latestVersion) {
          const versionInfo = obsidianDLC.versions[latestVersion];
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
              setCurrentMagnet(versionInfo.magnet);
              setIsDownloadComplete(false);
            }
          }
        }
      }
    } catch (error) {
      console.error('检查下载状态失败:', error);
    }
  };

  const updateDownloadProgress = async () => {
    try {
      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const obsidianDLC = dlcIndex.find(
        (item) => item.id === 'OBSIDIAN_SETUP_EXE',
      );
      if (obsidianDLC) {
        const latestVersion = Object.keys(obsidianDLC.versions).sort().pop();
        if (latestVersion) {
          const versionInfo = obsidianDLC.versions[latestVersion];
          if (versionInfo.progress) {
            const progress = versionInfo.progress.progress || 0;
            setDownloadProgress(Math.floor(progress * 100));
            if (progress >= 1) {
              setDownloading(false);
              setIsDownloadComplete(true);
              message.success('下载完成，可以点击安装按钮进行安装');
            }
          }
        }
      }
    } catch (error) {
      console.error('获取下载进度失败:', error);
    }
  };

  const handleDownloadOrInstall = async () => {
    // 如果已经下载完成，直接安装
    if (isDownloadComplete) {
      handleInstallObsidian();
      return;
    }

    // 否则开始下载
    try {
      setDownloading(true);
      setDownloadProgress(0);
      message.info('正在启动下载...');

      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const obsidianDLC = dlcIndex.find(
        (item) => item.id === 'OBSIDIAN_SETUP_EXE',
      );

      if (!obsidianDLC) {
        throw new Error('未找到Obsidian安装包信息');
      }

      const latestVersion = Object.keys(obsidianDLC.versions).sort().pop();
      if (!latestVersion) {
        throw new Error('未找到可用版本');
      }

      const versionInfo = obsidianDLC.versions[latestVersion];
      const magnet = versionInfo.magnet;
      setCurrentMagnet(magnet);

      const result = await window.mainHandle.startWebtorrentHandle(magnet);
      if (result.success) {
        message.success(`开始下载Obsidian ${latestVersion}`);
      } else {
        throw new Error('error' in result ? result.error : '启动下载失败');
      }
    } catch (error) {
      console.error('下载Obsidian失败:', error);
      message.error('下载失败：' + error.message);
      setDownloading(false);
      setCurrentMagnet(null);
    }
  };

  const handleCancelDownload = async () => {
    if (!currentMagnet) {
      message.warning('没有正在进行的下载');
      return;
    }
    try {
      await window.mainHandle.pauseWebtorrentHandle(currentMagnet);
      setDownloading(false);
      setDownloadProgress(0);
      setCurrentMagnet(null);
      message.info('已取消下载');
    } catch (error) {
      console.error('取消下载失败:', error);
      message.error('取消下载失败');
    }
  };

  const handleInstallObsidian = async () => {
    try {
      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const obsidianDLC = dlcIndex.find(
        (item) => item.id === 'OBSIDIAN_SETUP_EXE',
      );

      if (!obsidianDLC) {
        throw new Error('未找到Obsidian安装包');
      }

      const latestVersion = Object.keys(obsidianDLC.versions).sort().pop();
      if (!latestVersion) {
        throw new Error('未找到可用版本');
      }

      const versionInfo = obsidianDLC.versions[latestVersion];
      if (!versionInfo.progress || versionInfo.progress.progress < 1) {
        message.warning('请先完成下载');
        return;
      }

      message.info('正在打开安装程序...');
      cmdAction('install', 'obsidianApp');
    } catch (error) {
      console.error('打开安装程序失败:', error);
      message.error('失败：' + error.message);
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
                    {isDownloadComplete ? '安装Obsidian' : '更新Obsidian'}
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
