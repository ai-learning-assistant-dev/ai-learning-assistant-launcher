import {
  Button,
  message,
  Space,
  Modal,
  notification,
  Popconfirm,
  Progress,
} from 'antd';
import { NavLink } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react'; // 添加 useRef 导入
import obsidianLogo from './2023_Obsidian_logo.png';
import llmIcon from './LLM_Icon.png';
import heroImage from './Frame 2.png';
import welcomeImage from './Welcome.png';
import qrCodeImage from './QR_code_image.png';
import subjectIcon from './subject_icon.png';
// 新增导入Frame 3和Frame 8图片
import frame3 from './Frame 3.png';
import frame8 from './Frame 8.png';
import jointBuildIcon from '../../../../icons/joint_build.png';
import './index.scss';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useNativeTrainingServiceShortcut } from '../../containers/use-native-training-service-shortcut';
import { useLogContainer } from '../../containers/backup';
import { useRtsService } from '../../containers/use-rts-service';
import { TorrentProgress } from '../../containers/torrent-progress';
import { TerminalLogScreen } from '../../containers/terminal-log-screen';
import toolsIcon from './Tools_Icon.png';
import Checkbox, { CheckboxChangeEvent } from 'antd/es/checkbox/Checkbox';
import { TrainingConfig } from '../../../main/configs/type-info';

export default function Hello() {
  const trainingShortcut = useNativeTrainingServiceShortcut();
  const { exportLogs, setupBackupListener } = useLogContainer();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showTerminalLog, setShowTerminalLog] = useState(false);

  useEffect(() => {
    const cancel = setupBackupListener();

    return () => {
      if (cancel) cancel();
    };
  }, [setupBackupListener]);

  // 初始化托盘状态（根据共建开关）
  useEffect(() => {
    const initTrayStatus = async () => {
      const masterSwitch = localStorage.getItem('joint_build_master_switch');
      const welcomeChoice = localStorage.getItem(
        'ai_learning_assistant_welcome_shown',
      );

      let trayEnabled = false;
      if (masterSwitch !== null) {
        trayEnabled = masterSwitch === 'true';
      } else if (welcomeChoice === 'true') {
        trayEnabled = true;
      }

      try {
        await window.mainHandle.setTrayEnabled(trayEnabled);
      } catch (error) {
        console.error('初始化托盘状态失败:', error);
      }
    };

    initTrayStatus();
  }, []);

  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      content: (
        <img src={welcomeImage} alt="Welcome" className="hero-image-slide" />
      ),
    },
    {
      content: <img src={heroImage} alt="Hero" className="hero-image-slide" />,
    },
    {
      content: <img src={frame3} alt="Frame 3" className="hero-image-slide" />,
    },
    {
      content: <img src={frame8} alt="Frame 8" className="hero-image-slide" />,
    },
  ];

  const slideInterval = useRef<NodeJS.Timeout | null>(null);

  const clearSlideInterval = () => {
    if (slideInterval.current) {
      clearInterval(slideInterval.current);
      slideInterval.current = null;
    }
  };

  const startAutoSlide = () => {
    clearSlideInterval();
    slideInterval.current = setInterval(() => {
      setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    }, 5000);
  };

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    startAutoSlide();
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
    startAutoSlide();
  };

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
    startAutoSlide();
  };

  const handleExportLogs = () => {
    exportLogs();
  };

  const showQrCodeModal = () => {
    setIsModalVisible(true);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  // 新增：打开使用文档
  const openUserManual = () => {
    window.electron?.ipcRenderer.sendMessage(
      'open-external-url',
      'open',
      'browser',
      'https://docs.qq.com/aio/DS1NnZkZkdkFiSVdP',
    );
  };
  // 新增：打开使用文档
  // const openUserManual = async () => {
  //   try {
  //     await window.electron.shell.openExternal('https://docs.qq.com/aio/DS1NnZkZkdkFiSVdP');
  //   } catch (error) {
  //     console.error('无法打开外部链接:', error);
  //     // 可以降级使用 window.open()
  //     window.open('https://docs.qq.com/aio/DS1NnZkZkdkFiSVdP', '_blank');
  //   }
  // };

  // 修改 calculateScaleAndPosition 函数
  const calculateScaleAndPosition = () => {
    if (containerRef.current && contentRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      const containerHeight = containerRef.current.offsetHeight;

      // 基准尺寸（设计尺寸）
      const baseWidth = 1280;
      const baseHeight = 900;

      // 计算缩放比例，取较小的值以确保内容完整显示
      const scaleX = containerWidth / baseWidth;
      const scaleY = containerHeight / baseHeight;
      const newScale = Math.min(scaleX, scaleY, 1); // 不放大超过原始尺寸

      setScale(newScale);
    }
  };

  useEffect(() => {
    startAutoSlide();
    checkLauncherUpdate();

    return () => {
      clearSlideInterval();
    };
  }, []);

  // 添加窗口大小变化监听
  useEffect(() => {
    // 初始计算
    calculateScaleAndPosition();

    // 添加窗口大小变化监听器
    const handleResize = () => {
      calculateScaleAndPosition();
    };

    window.addEventListener('resize', handleResize);

    // 组件卸载时移除监听器
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const [trainingServiceStarting, setTrainingServiceStarting] = useState(false);

  const openTrainingService = async () => {
    setShowTerminalLog(true);
    setTrainingServiceStarting(true);
    try {
      await trainingShortcut.start();
    } catch (e) {
      message.error(e.message);
    }
    setTrainingServiceStarting(false);
  };

  const [trainingServiceRemoving, setTrainingServiceRemoving] = useState(false);
  const [launcherUpdateInfo, setLauncherUpdateInfo] = useState<{
    currentVersion: string;
    latestVersion: string;
    haveNew: boolean;
  } | null>(null);
  const [launcherUpdating, setLauncherUpdating] = useState(false);
  const [launcherDownloadProgress, setLauncherDownloadProgress] = useState(0);
  const [launcherDownloadComplete, setLauncherDownloadComplete] =
    useState(false);
  const [launcherMagnet, setLauncherMagnet] = useState<string | null>(null);

  // 轮询下载进度
  useEffect(() => {
    if (!launcherUpdating || !launcherUpdateInfo?.haveNew) return;

    let mounted = true;
    const fetchProgress = async () => {
      try {
        const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
        const dlc = dlcIndex.find(
          (item) => item.id === 'AI_LEARNING_ASSISTANT_LAUNCHER',
        );
        if (!dlc || !mounted) return;

        const versionInfo = dlc.versions[launcherUpdateInfo.latestVersion];
        if (versionInfo?.progress) {
          const progress = (versionInfo.progress.progress || 0) * 100;
          if (mounted) {
            setLauncherDownloadProgress(progress);
          }
        }
      } catch (error) {
        console.error('获取下载进度失败:', error);
      }
    };

    fetchProgress();
    const intervalId = setInterval(fetchProgress, 1000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [launcherUpdating, launcherUpdateInfo]);

  const removeTrainingService = async () => {
    setTrainingServiceRemoving(true);
    await trainingShortcut.remove();
    setTrainingServiceRemoving(false);
  };

  const updateCourseTrainingService = async () => {
    setTrainingServiceStarting(true);
    setTrainingServiceRemoving(true);
    await trainingShortcut.updateCourse();
    message.success('学科培训课程更新成功');
    setTrainingServiceStarting(false);
    setTrainingServiceRemoving(false);
  };

  const updateTrainingService = async () => {
    setShowTerminalLog(true);
    setTrainingServiceStarting(true);
    setTrainingServiceRemoving(true);
    await trainingShortcut.update();
    message.success('学科培训更新成功');
    setTrainingServiceStarting(false);
    setTrainingServiceRemoving(false);
  };

  const checkLauncherUpdate = async () => {
    try {
      const info = await window.mainHandle.checkLauncherUpdateHandle();
      setLauncherUpdateInfo(info);

      // 检查是否已有下载完成的更新包，或正在下载中（用于恢复后台下载状态）
      if (info?.haveNew) {
        const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
        const dlc = dlcIndex.find(
          (item) => item.id === 'AI_LEARNING_ASSISTANT_LAUNCHER',
        );
        if (dlc) {
          const versionInfo = dlc.versions[info.latestVersion];
          if (versionInfo?.progress) {
            const progress = versionInfo.progress.progress || 0;
            if (progress >= 1) {
              // 下载已完成
              setLauncherDownloadComplete(true);
              setLauncherDownloadProgress(100);
              setLauncherUpdating(false);
            } else if (progress > 0) {
              // 正在下载中，恢复下载状态
              setLauncherUpdating(true);
              setLauncherDownloadProgress(progress * 100);
              setLauncherMagnet(versionInfo.magnet);
              setLauncherDownloadComplete(false);
            }
          }
        }
      }
    } catch (error) {
      console.error('检查启动器更新失败:', error);
    }
  };

  const handleLauncherUpdate = async () => {
    if (!launcherUpdateInfo || !launcherUpdateInfo.haveNew) {
      message.info('已是最新版本');
      return;
    }

    // 如果下载已完成，直接执行安装
    if (launcherDownloadComplete) {
      setLauncherUpdating(true);
      try {
        const result = await window.mainHandle.installLauncherUpdateHandle();
        if (result.success) {
          message.success(result.message);
        } else {
          message.warning(result.message);
        }
      } catch (error) {
        console.error('安装启动器更新失败:', error);
        message.error('安装失败：' + error.message);
      } finally {
        setLauncherUpdating(false);
      }
      return;
    }

    setLauncherUpdating(true);
    setLauncherDownloadProgress(0);
    setLauncherDownloadComplete(false);

    try {
      // 获取 DLC 信息并保存 magnet
      const dlcIndex = await window.mainHandle.queryWebtorrentHandle();
      const dlc = dlcIndex.find(
        (item) => item.id === 'AI_LEARNING_ASSISTANT_LAUNCHER',
      );
      if (dlc && launcherUpdateInfo) {
        const versionInfo = dlc.versions[launcherUpdateInfo.latestVersion];
        if (versionInfo?.magnet) {
          setLauncherMagnet(versionInfo.magnet);
        }
      }

      const downloadResult =
        await window.mainHandle.downloadLauncherUpdateHandle();

      // 开发模式下不执行安装，直接提示
      if (downloadResult.isDev) {
        message.warning('开发模式下不支持自动更新，请手动解压');
        setLauncherUpdating(false);
        return;
      }

      setLauncherDownloadProgress(100);
      setLauncherDownloadComplete(true);
      setLauncherUpdating(false);
      setLauncherMagnet(null);
      message.success('下载完成，点击按钮重启并更新');
    } catch (error) {
      console.error('更新启动器失败:', error);
      message.error('更新失败：' + error.message);
      setLauncherUpdating(false);
      setLauncherDownloadProgress(0);
      setLauncherMagnet(null);
    }
  };

  const handleCancelLauncherUpdate = async () => {
    if (!launcherMagnet) {
      message.warning('没有正在进行的下载');
      return;
    }
    try {
      await window.mainHandle.pauseWebtorrentHandle(launcherMagnet);
      setLauncherUpdating(false);
      setLauncherDownloadProgress(0);
      setLauncherMagnet(null);
      message.info('已取消下载');
    } catch (error) {
      console.error('取消下载失败:', error);
      message.error('取消下载失败');
    }
  };

  const [trainingConfig, setTrainingConfig] = useState<TrainingConfig | null>(
    null,
  );

  useEffect(() => {
    window.mainHandle
      .queryNativeTrainingConfigHandle()
      .then((res) => setTrainingConfig(res));
  });

  const handleTrainingConfigChange = useCallback(
    async (e: CheckboxChangeEvent) => {
      window.mainHandle.setNativeTrainingConfigHandle({
        env: {
          UNLOCK_ALL_SECTION: e.target.checked,
        },
      });
    },
    [],
  );

  return (
    <div className="hello-root" ref={containerRef}>
      <div
        className="scale-wrapper"
        style={{
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        <div className="hello-container" ref={contentRef}>
          <div className="hello-content">
            {showTerminalLog ? (
              <div className="hello-header">
                <TerminalLogScreen
                  id="hello-terminal-log"
                  cols={100}
                  rows={30}
                  style={{
                    width: 'calc(100%)',
                    marginTop: '16px',
                    height: '430px',
                  }}
                />
              </div>
            ) : (
              <div className="hello-header">
                <div className="header-content">
                  <div className="hero-image">
                    <div className="carousel-container">
                      {slides.map((slide, index) => (
                        <div
                          key={index}
                          className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}
                        >
                          {slide.content}
                        </div>
                      ))}
                    </div>

                    <div className="carousel-bottom-controls">
                      <div className="carousel-indicators">
                        {slides.map((_, index) => (
                          <div
                            key={index}
                            className={`indicator ${index === currentSlide ? 'active' : ''}`}
                            onClick={() => goToSlide(index)}
                          />
                        ))}
                      </div>
                      <div className="carousel-navigation">
                        <button
                          className="carousel-control-bottom"
                          onClick={prevSlide}
                        >
                          <Space>
                            <LeftOutlined />
                          </Space>
                        </button>
                        <button
                          className="carousel-control-bottom"
                          onClick={nextSlide}
                        >
                          <Space>
                            <RightOutlined />
                          </Space>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="features-section">
              <div className="features-container">
                <div className="feature-card">
                  <div className="feature-wrapper">
                    <div className="feature-icon-text">
                      <div className="obsidian-logo-container">
                        <img
                          className="obsidian-logo"
                          src={obsidianLogo}
                          alt="Obsidian Logo"
                        />
                      </div>
                      <span className="feature-title">阅读器</span>
                    </div>
                    <p className="feature-description">
                      启动、管理obsidian阅读器仓库和插件
                    </p>
                  </div>
                  <div className="feature-button-container">
                    <NavLink to="/obsidian-app" style={{ width: '100%' }}>
                      <Button className="feature-button" block size="large">
                        开始
                      </Button>
                    </NavLink>
                  </div>
                </div>

                <div className="feature-card">
                  <div className="feature-wrapper">
                    <div className="feature-icon-text">
                      <div className="tools-icon-container">
                        <img
                          className="tools-icon"
                          src={toolsIcon}
                          alt="Tools Icon"
                        />
                      </div>
                      <span className="feature-title">工具箱</span>
                    </div>
                    <p className="feature-description long-description">
                      一站式管理多种实用AI工具，目前包含文字转语音、语音转文字、PDF转MarkDown三大功能，让技术操作变得简单快捷
                    </p>
                  </div>
                  <div className="feature-button-container">
                    <NavLink to="/native-ai-service" style={{ width: '100%' }}>
                      <Button className="feature-button" block size="large">
                        开始
                      </Button>
                    </NavLink>
                  </div>
                </div>

                <div className="feature-card">
                  <div className="feature-wrapper">
                    <div className="feature-icon-text">
                      <div className="llm-icon-container">
                        <img
                          className="llm-icon"
                          src={llmIcon}
                          alt="LLM Icon"
                        />
                      </div>
                      <span className="feature-title">大模型</span>
                    </div>
                    <p className="feature-description long-description">
                      统一管理本地与在线AI模型的API，并可轻松为Obsidian
                      Copilot等应用设置密钥，省去繁琐步骤
                    </p>
                  </div>
                  <div className="feature-button-container">
                    <NavLink to="/lm-service" style={{ width: '100%' }}>
                      <Button className="feature-button" block size="large">
                        开始
                      </Button>
                    </NavLink>
                  </div>
                </div>

                <div className="feature-card">
                  <div className="feature-wrapper">
                    <div className="feature-icon-text">
                      <div className="subject-icon-container">
                        <img
                          className="subject-icon"
                          src={subjectIcon}
                          alt="Subject Icon"
                        />
                      </div>
                      <span className="feature-title">学科培训</span>
                    </div>
                    <div className="feature-description">
                      <p className="description-text">
                        AI辅助的学科知识培训，学员建档设立目标，帮助补齐技能知识短板。
                        {trainingShortcut.state !== 'not_install' &&
                          `当前版本：${trainingShortcut.courseVersionInfo.currentVersion}`}
                        <Checkbox
                          checked={trainingConfig?.env.UNLOCK_ALL_SECTION}
                          onChange={handleTrainingConfigChange}
                        >
                          进行非线性学习
                        </Checkbox>
                      </p>
                    </div>
                    {trainingShortcut.state === 'updating' && (
                      <TorrentProgress
                        id={'TRAINING_COURSE'}
                        version={
                          trainingShortcut.courseVersionInfo.latestVersion
                        }
                      />
                    )}
                  </div>
                  <div className="feature-button-container">
                    {!(
                      (trainingShortcut.state === 'stopped' ||
                        trainingShortcut.state === 'updating') &&
                      (trainingShortcut.courseVersionInfo.haveNew ||
                        trainingShortcut.programVersionInfo.haveNew)
                    ) && (
                      <Button
                        className="feature-button"
                        block
                        size="large"
                        onClick={openTrainingService}
                        loading={
                          trainingServiceStarting || trainingShortcut.initing
                        }
                        disabled={trainingServiceRemoving}
                      >
                        {trainingShortcut.state === 'not_install'
                          ? '安装'
                          : '开始'}
                      </Button>
                    )}
                    {(trainingShortcut.state === 'stopped' ||
                      trainingShortcut.state === 'updating') &&
                      trainingShortcut.courseVersionInfo.haveNew &&
                      !trainingShortcut.programVersionInfo.haveNew && (
                        <Button
                          className="feature-button"
                          block
                          size="large"
                          onClick={updateCourseTrainingService}
                          loading={trainingServiceRemoving}
                        >
                          更新课程
                        </Button>
                      )}
                    {(trainingShortcut.state === 'stopped' ||
                      trainingShortcut.state === 'updating') &&
                      trainingShortcut.programVersionInfo.haveNew && (
                        <Button
                          className="feature-button"
                          block
                          size="large"
                          onClick={updateTrainingService}
                          loading={trainingServiceRemoving}
                        >
                          更新
                        </Button>
                      )}
                    {trainingShortcut.state !== 'not_install' && (
                      <Button
                        className="feature-button"
                        block
                        size="large"
                        onClick={() => setShowTerminalLog(true)}
                        disabled={trainingServiceRemoving}
                      >
                        日志
                      </Button>
                    )}
                    {trainingShortcut.state !== 'not_install' && (
                      <Button
                        className="feature-button uninstall"
                        block
                        size="large"
                        onClick={removeTrainingService}
                        loading={trainingServiceRemoving}
                      >
                        卸载
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="hello-footer">
              <div className="version-info">
                版本号：{__NPM_PACKAGE_VERSION__} 源码版本：{__COMMIT_HASH__}
              </div>
              <div className="log-export">
                <NavLink to="/joint-build" className="joint-build-link">
                  <Button className="joint-build-button">
                    <img
                      src={jointBuildIcon}
                      alt="共建计划"
                      className="joint-build-icon"
                    />
                    <span>共建计划</span>
                  </Button>
                </NavLink>
                {/* <NavLink to="/p2p-test">
                  <Button className="manual-button">P2P测试</Button>
                </NavLink> */}
                {launcherUpdateInfo?.haveNew && (
                  <div className="launcher-update-wrapper">
                    {launcherUpdating && !launcherDownloadComplete && (
                      <Progress
                        type="circle"
                        percent={Math.round(launcherDownloadProgress)}
                        size={28}
                        strokeWidth={10}
                        strokeColor="#1677ff"
                      />
                    )}
                    {launcherUpdating && !launcherDownloadComplete ? (
                      <Button
                        className="status-indicator update-button"
                        danger
                        onClick={handleCancelLauncherUpdate}
                      >
                        <span className="log-text">取消下载</span>
                      </Button>
                    ) : (
                      <Button
                        className={`status-indicator update-button ${launcherDownloadComplete ? 'download-complete' : ''}`}
                        onClick={handleLauncherUpdate}
                        loading={launcherUpdating && launcherDownloadComplete}
                      >
                        <span className="log-text">
                          {launcherDownloadComplete ? '重启并更新' : '更新'}
                        </span>
                      </Button>
                    )}
                  </div>
                )}
                <Button
                  className="status-indicator"
                  onClick={handleExportLogs}
                  type="primary"
                >
                  <span className="log-text">日志导出</span>
                </Button>
                <Button className="manual-button" onClick={openUserManual}>
                  使用文档
                </Button>
                <Button className="get-help-button" onClick={showQrCodeModal}>
                  获取帮助
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Modal
        className="qr-modal"
        open={isModalVisible}
        onCancel={handleCancel}
        footer={null}
        centered
      >
        <img className="qr-code-image" src={qrCodeImage} alt="QQ群二维码" />
        <p className="qr-description">
          扫描二维码加入QQ群，关于AI学习助手，在群中提出你的任何疑问，会有专业人员解答
        </p>
      </Modal>
    </div>
  );
}
