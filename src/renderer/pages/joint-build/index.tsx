import { Switch, Button, Progress, message, Slider } from 'antd';
import { NavLink } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import { LeftOutlined } from '@ant-design/icons';
import jointBuildIcon from '../../../../icons/joint_build.png';
import { DLCIndex, OneDLCInfo } from '../../../main/dlc/type-info';
import './index.scss';

const STORAGE_KEY_MASTER = 'joint_build_master_switch';
const STORAGE_KEY_DISK_PATH = 'joint_build_disk_path';
const STORAGE_KEY_WELCOME = 'ai_learning_assistant_welcome_shown'; // 欢迎弹窗用户选择
const STORAGE_KEY_UPLOAD_LIMIT = 'joint_build_upload_limit';

// 字节转GB
const bytesToGB = (bytes: number): number => {
  return Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10;
};

// 格式化字节大小
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// 获取做种状态（只要种子添加到 WebTorrent 中就可以显示）
function getSeedingState(version: OneDLCInfo['versions'][string]): '未下载' | '已暂停做种' | '做种中' | '验证中' {
  // 只要 progress 存在，就说明种子已添加到 WebTorrent
  if (version.progress) {
    // 完全完成或进度 >= 99%
    if (version.progress.done || version.progress.progress >= 0.99) {
      if (version.progress.paused) {
        return '已暂停做种';
      } else {
        return '做种中';
      }
    }
    // 有进度但未完成（验证中或部分下载）
    if (version.progress.progress > 0) {
      if (version.progress.paused) {
        return '已暂停做种';
      } else {
        return '验证中';
      }
    }
  }
  return '未下载';
}

// 获取状态颜色
function getStateColor(state: string): string {
  switch (state) {
    case '做种中':
      return '#52c41a';
    case '已暂停做种':
      return '#faad14';
    case '验证中':
      return '#1890ff';
    default:
      return '#999';
  }
}

export default function JointBuild() {
  const [masterSwitch, setMasterSwitch] = useState(false);
  const [diskPath, setDiskPath] = useState('C:\\');
  const [diskUsed, setDiskUsed] = useState(0);
  const [diskTotal, setDiskTotal] = useState(0);
  const [diskLoading, setDiskLoading] = useState(false);
  const [dLCIndex, setDLCIndex] = useState<DLCIndex>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(1);
  const [uploadLimit, setUploadLimit] = useState(0); // 0 表示不限速，单位 KB/s
  const uploadLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 定时刷新DLC数据
  useEffect(() => {
    window.mainHandle
      .queryWebtorrentHandle()
      .then((newDLCIndex) => setDLCIndex(newDLCIndex))
      .catch((err) => {
        // 降低日志频率，只在首次或间隔打印
        if (refreshTrigger === 1 || refreshTrigger % 10 === 0) {
          console.error('查询WebTorrent状态失败:', err);
        }
      });
    const timeout = setTimeout(
      () => setRefreshTrigger(refreshTrigger + 1),
      3000, // 从1秒改为3秒，降低刷新和日志频率
    );
    return () => {
      clearTimeout(timeout);
    };
  }, [refreshTrigger]);

  // 获取磁盘信息
  const fetchDiskInfo = useCallback(async (path: string) => {
    setDiskLoading(true);
    try {
      const diskInfo = await window.mainHandle.getJointBuildDiskInfo(path);
      setDiskTotal(bytesToGB(diskInfo.total));
      setDiskUsed(bytesToGB(diskInfo.used));
    } catch (error) {
      console.error('获取磁盘信息失败:', error);
    } finally {
      setDiskLoading(false);
    }
  }, []);

  // 从 localStorage 加载配置
  useEffect(() => {
    // 优先读取共建开关的设置，如果没有则读取欢迎弹窗的用户选择
    const savedMasterSwitch = localStorage.getItem(STORAGE_KEY_MASTER);
    let initialMasterSwitch = false;
    
    if (savedMasterSwitch !== null) {
      initialMasterSwitch = savedMasterSwitch === 'true';
    } else {
      // 如果没有单独设置过共建开关，则读取欢迎弹窗的选择
      const welcomeChoice = localStorage.getItem(STORAGE_KEY_WELCOME);
      if (welcomeChoice === 'true') {
        initialMasterSwitch = true;
      }
    }
    
    setMasterSwitch(initialMasterSwitch);
    // 初始化时同步托盘状态到主进程
    window.mainHandle.setTrayEnabled(initialMasterSwitch).catch(console.error);

    const savedDiskPath = localStorage.getItem(STORAGE_KEY_DISK_PATH);
    const initialPath = savedDiskPath || 'C:\\';
    setDiskPath(initialPath);
    
    // 加载上传限速设置
    const savedUploadLimit = localStorage.getItem(STORAGE_KEY_UPLOAD_LIMIT);
    const initialLimit = savedUploadLimit ? parseInt(savedUploadLimit, 10) : 0;
    setUploadLimit(initialLimit);
    // 同步到后端
    window.mainHandle.setUploadLimit(initialLimit * 1024).catch(console.error); // 转换为 bytes/s
    
    // 初始化时获取磁盘信息
    fetchDiskInfo(initialPath);
  }, [fetchDiskInfo]);

  // 监听托盘菜单的状态变化
  useEffect(() => {
    const handleStatusChange = (event: CustomEvent<boolean>) => {
      setMasterSwitch(event.detail);
    };
    
    window.addEventListener('joint-build-status-changed', handleStatusChange as EventListener);
    
    return () => {
      window.removeEventListener('joint-build-status-changed', handleStatusChange as EventListener);
      // 清理上传限速防抖定时器
      if (uploadLimitTimerRef.current) {
        clearTimeout(uploadLimitTimerRef.current);
      }
    };
  }, []);

  // 保存配置到 localStorage
  const saveConfig = (master: boolean) => {
    localStorage.setItem(STORAGE_KEY_MASTER, String(master));
  };

  const handleMasterSwitchChange = async (checked: boolean) => {
    setMasterSwitch(checked);
    saveConfig(checked);
    
    // 同步托盘状态到主进程
    try {
      await window.mainHandle.setTrayEnabled(checked);
    } catch (error) {
      console.error('设置托盘状态失败:', error);
    }
    
    if (checked) {
      message.success('共建计划已开启，关闭窗口后将最小化到托盘');
    } else {
      message.info('共建计划已关闭');
    }
  };

  // 处理上传限速变化（防抖：UI 实时更新，后端调用延迟）
  const handleUploadLimitChange = (value: number) => {
    setUploadLimit(value);
    
    // 清除之前的定时器
    if (uploadLimitTimerRef.current) {
      clearTimeout(uploadLimitTimerRef.current);
    }
    
    // 防抖：500ms 后才同步到后端
    uploadLimitTimerRef.current = setTimeout(async () => {
      localStorage.setItem(STORAGE_KEY_UPLOAD_LIMIT, String(value));
      try {
        await window.mainHandle.setUploadLimit(value * 1024); // 转换为 bytes/s
      } catch (error) {
        console.error('设置上传限速失败:', error);
      }
    }, 500);
  };

  // 处理开始做种
  const handleStartSeeding = async (magnet: string) => {
    try {
      await window.mainHandle.startWebtorrentHandle(magnet);
      message.success('开始做种');
    } catch (error) {
      console.error('启动做种失败:', error);
      message.error('启动做种失败');
    }
  };

  // 处理暂停做种
  const handlePauseSeeding = async (magnet: string) => {
    try {
      await window.mainHandle.pauseWebtorrentHandle(magnet);
      message.info('已暂停做种');
    } catch (error) {
      console.error('暂停失败:', error);
      message.error('暂停失败');
    }
  };

  const handleChangePath = async () => {
    try {
      const newPath = await window.mainHandle.selectJointBuildFolder();
      if (newPath) {
        setDiskPath(newPath);
        localStorage.setItem(STORAGE_KEY_DISK_PATH, newPath);
        message.success('路径已更新');
        // 获取新路径的磁盘信息
        fetchDiskInfo(newPath);
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
      message.error('选择文件夹失败');
    }
  };

  // 获取最新版本
  const getLatestVersion = (dlc: OneDLCInfo): { key: string; version: OneDLCInfo['versions'][string] } | null => {
    const versionKeys = Object.keys(dlc.versions);
    if (versionKeys.length === 0) return null;
    // 按版本号排序，取最新的
    const sortedKeys = versionKeys.sort((a, b) => {
      const partsA = a.split('.').map(Number);
      const partsB = b.split('.').map(Number);
      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;
        if (numA !== numB) return numB - numA;
      }
      return 0;
    });
    return { key: sortedKeys[0], version: dlc.versions[sortedKeys[0]] };
  };

  const diskUsedPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;

  return (
    <div className="joint-build-page">
      <div className="header-container">
        <NavLink to="/hello" className="back-link">
          <LeftOutlined />
        </NavLink>
        <img src={jointBuildIcon} alt="共建计划" className="header-icon" />
        <div className="header-text">
          <h1>共建计划</h1>
          <p>通过闲时分享少量带宽，不仅能加速您的下载，也能帮助其他学习者更快获取大模型与课程资源。</p>
        </div>
      </div>

      <div className="section">
        <h2>服务状态</h2>
        <div className="switch-card">
          <span className="switch-label">共建总开关</span>
          <Switch
            checked={masterSwitch}
            onChange={handleMasterSwitchChange}
          />
        </div>
        <div className="switch-card upload-limit-card">
          <span className="switch-label">上传限速</span>
          <div className="slider-container">
            <Slider
              min={0}
              max={20480}
              step={64}
              value={uploadLimit}
              onChange={handleUploadLimitChange}
              tooltip={{
                formatter: (value) => value === 0 ? '不限速' : `${value} KB/s`
              }}
              style={{ width: '50%' }}
            />
            <span className="limit-value">
              {uploadLimit === 0 ? '不限速' : `${uploadLimit} KB/s`}
            </span>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>可用磁盘空间</h2>
        <div className="disk-info">
          <span className="disk-path">磁盘路径：{diskPath}</span>
          <Button onClick={handleChangePath}>更换路径</Button>
        </div>
        <div className="disk-stats">
          <span>已用 {diskUsed} GB / 总计 {diskTotal} GB</span>
        </div>
        <Progress
          percent={diskUsedPercent}
          showInfo={false}
          strokeColor="#333"
          trailColor="#e5e5e5"
        />
      </div>

      <div className="section">
        <h2>共建参与模块</h2>
        <p className="section-desc">以下是您已下载的资源包，开启做种可以帮助其他学习者更快获取资源</p>
        <div className="modules-list">
          {dLCIndex.map((dlc) => {
            const latestVersionInfo = getLatestVersion(dlc);
            if (!latestVersionInfo) return null;
            
            const { key: versionKey, version } = latestVersionInfo;
            const state = getSeedingState(version);
            const progress = version.progress;
            
            // 只显示已下载完成的资源
            if (state === '未下载') return null;
            
            return (
              <div key={dlc.id} className="module-card">
                <div className="module-info">
                  <div className="module-header">
                    <span className="module-name">{dlc.name}</span>
                    <span className="module-version">v{versionKey}</span>
                  </div>
                  <div className="module-status">
                    <span 
                      className="status-badge"
                      style={{ color: getStateColor(state) }}
                    >
                      {state}
                    </span>
                  </div>
                  {progress && (
                    <div className="module-stats">
                      {progress.uploadSpeed > 0 && (
                        <span>↑ {formatBytes(progress.uploadSpeed)}/s</span>
                      )}
                      {progress.numPeers > 0 && (
                        <span>节点: {progress.numPeers}</span>
                      )}
                      {state === '验证中' && (
                        <span>进度: {Math.round(progress.progress * 100)}%</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="module-actions">
                  {(state === '已暂停做种' || state === '验证中') && (
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => handleStartSeeding(version.magnet)}
                      disabled={!masterSwitch}
                    >
                      {state === '验证中' ? '继续验证' : '开始做种'}
                    </Button>
                  )}
                  {state === '做种中' && (
                    <Button
                      size="small"
                      onClick={() => handlePauseSeeding(version.magnet)}
                    >
                      暂停做种
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {dLCIndex.filter(dlc => {
            const latestVersionInfo = getLatestVersion(dlc);
            if (!latestVersionInfo) return false;
            return getSeedingState(latestVersionInfo.version) !== '未下载';
          }).length === 0 && (
            <div className="empty-tip">暂无已下载的资源包可供做种</div>
          )}
        </div>
      </div>
    </div>
  );
}
