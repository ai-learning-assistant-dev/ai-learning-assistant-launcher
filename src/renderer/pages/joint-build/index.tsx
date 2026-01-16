import { Switch, Button, Progress, message } from 'antd';
import { NavLink } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { LeftOutlined } from '@ant-design/icons';
import jointBuildIcon from '../../../../icons/joint_build.png';
import './index.scss';

interface ModuleItem {
  id: string;
  name: string;
  description: string;
  diskUsage: string;
  recommendLevel: number; // 1-3
  enabled: boolean;
}

const STORAGE_KEY_MASTER = 'joint_build_master_switch';
const STORAGE_KEY_MODULES = 'joint_build_modules';
const STORAGE_KEY_DISK_PATH = 'joint_build_disk_path';
const STORAGE_KEY_WELCOME = 'ai_learning_assistant_welcome_shown'; // 欢迎弹窗用户选择

// 字节转GB
const bytesToGB = (bytes: number): number => {
  return Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10;
};

export default function JointBuild() {
  const [masterSwitch, setMasterSwitch] = useState(false);
  const [diskPath, setDiskPath] = useState('C:\\');
  const [diskUsed, setDiskUsed] = useState(0);
  const [diskTotal, setDiskTotal] = useState(0);
  const [diskLoading, setDiskLoading] = useState(false);
  // todo: 这些数据从哪获取？还是写死
  const [modules, setModules] = useState<ModuleItem[]>([
    {
      id: 'launcher',
      name: 'AI学习助手启动器',
      description: '磁盘占用 200MB',
      diskUsage: '200MB',
      recommendLevel: 3,
      enabled: true,
    },
    {
      id: 'training-package',
      name: '学科培训安装包',
      description: '磁盘占用 200MB',
      diskUsage: '200MB',
      recommendLevel: 3,
      enabled: false,
    },
    {
      id: 'voice-model',
      name: '学科培训语音模型',
      description: '磁盘占用 2.1GB',
      diskUsage: '2.1GB',
      recommendLevel: 2,
      enabled: false,
    },
  ]);

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

    const savedModules = localStorage.getItem(STORAGE_KEY_MODULES);
    if (savedModules) {
      try {
        const parsed = JSON.parse(savedModules);
        setModules((prev) =>
          prev.map((mod) => {
            const saved = parsed.find((s: ModuleItem) => s.id === mod.id);
            return saved ? { ...mod, enabled: saved.enabled } : mod;
          })
        );
      } catch (e) {
        console.error('Failed to parse saved modules:', e);
      }
    }

    const savedDiskPath = localStorage.getItem(STORAGE_KEY_DISK_PATH);
    const initialPath = savedDiskPath || 'C:\\';
    setDiskPath(initialPath);
    
    // 初始化时获取磁盘信息
    fetchDiskInfo(initialPath);
  }, [fetchDiskInfo]);

  // 保存配置到 localStorage
  const saveConfig = (master: boolean, mods: ModuleItem[]) => {
    localStorage.setItem(STORAGE_KEY_MASTER, String(master));
    localStorage.setItem(
      STORAGE_KEY_MODULES,
      JSON.stringify(mods.map((m) => ({ id: m.id, enabled: m.enabled })))
    );
  };

  const handleMasterSwitchChange = async (checked: boolean) => {
    setMasterSwitch(checked);
    saveConfig(checked, modules);
    
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

  const handleModuleToggle = (id: string, checked: boolean) => {
    const newModules = modules.map((mod) =>
      mod.id === id ? { ...mod, enabled: checked } : mod
    );
    setModules(newModules);
    saveConfig(masterSwitch, newModules);
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

  const renderRecommendLevel = (level: number) => {
    const fires = [];
    for (let i = 0; i < 3; i++) {
      fires.push(
        <span
          key={i}
          className={`recommend-fire ${i < level ? 'active' : ''}`}
        >
          🔥
        </span>
      );
    }
    return fires;
  };

  const diskUsedPercent = Math.round((diskUsed / diskTotal) * 100);

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
      </div>

      <div className="section">
        <h2>可用磁盘空间</h2>
        <div className="disk-info">
          <span className="disk-path">磁盘路径：{diskPath}</span>
          <Button onClick={handleChangePath}>更换路径</Button>
        </div>
        <Progress
          percent={diskUsedPercent}
          showInfo={false}
          strokeColor="#333"
          trailColor="#e5e5e5"
        />
      </div>

      <div className="section">
        <h2>共建参与模块设置</h2>
        <p className="section-desc">管理参与哪些模块的共建计划，请根据您电脑的磁盘空余选择开启</p>
        <div className="modules-list">
          {modules.map((mod) => (
            <div key={mod.id} className="module-card">
              <div className="module-info">
                <div className="module-header">
                  <span className="module-name">{mod.name}</span>
                  <span className="module-recommend">
                    推荐指数 {renderRecommendLevel(mod.recommendLevel)}
                  </span>
                </div>
                <span className="module-disk">磁盘占用 {mod.diskUsage}</span>
              </div>
              <Switch
                checked={mod.enabled}
                onChange={(checked) => handleModuleToggle(mod.id, checked)}
                disabled={!masterSwitch}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
