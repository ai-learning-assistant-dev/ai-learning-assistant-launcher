import { Button, message, Space, Modal, notification, Popconfirm } from 'antd';
import { NavLink } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react'; // 添加 useRef 导入
import obsidianLogo from './2023_Obsidian_logo.png';
import toolsIcon from './Tools_Icon.png';
import llmIcon from './LLM_Icon.png';
import heroImage from './Frame 2.png';
import welcomeImage from './Welcome.png';
import qrCodeImage from './QR_code_image.png';
import subjectIcon from './subject_icon.png';
import wslLogo from './wslLogo.png';
// 新增导入Frame 3和Frame 8图片
import frame3 from './Frame 3.png';
import frame8 from './Frame 8.png';
import './index.scss';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useTrainingServiceShortcut } from '../../containers/use-training-service-shortcut';
import { useLogContainer } from '../../containers/backup';
import { useVM } from '../../containers/use-vm';

export default function Hello() {
  const trainingServiceShortcut = useTrainingServiceShortcut();
  const { exportLogs, setupBackupListener } = useLogContainer();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const {
    isWSLInstalled,
    podmanChecking,
    needResintallPodman,
    wslVersion,
    wslChecking,
    wslLoading,
    wslOperation,
    handleCmdAction,
    isPodmanInstalled,
    showRebootModal,
    vTReady,
  } = useVM();

  useEffect(() => {
    const cancel = setupBackupListener();

    return () => {
      if (cancel) cancel();
    };
  }, [setupBackupListener]);

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
    window.electron?.ipcRenderer.sendMessage('open-external-url', 'open', 'browser', 'https://docs.qq.com/aio/DS1NnZkZkdkFiSVdP');
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
    setTrainingServiceStarting(true);
    try {
      await trainingServiceShortcut.start();
    } catch (e) {
      message.error(e.message);
    }
    setTrainingServiceStarting(false);
  };

  const [trainingServiceRemoving, setTrainingServiceRemoving] = useState(false);

  const removeTrainingService = async () => {
    setTrainingServiceRemoving(true);
    await trainingServiceShortcut.remove();
    setTrainingServiceRemoving(false);
  };

  const wslStatusText = () => {
    if (!vTReady) {
      return '请在BIOS开启虚拟化';
    } else {
      if (isWSLInstalled) {
        return `已安装 ${wslVersion ? `(${wslVersion.split('\n')[0]})` : ''}`;
      } else {
        return '未安装';
      }
    }
  };

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

            {/* WSL功能区域 */}
            <div className="wsl-section">
              <div className="wsl-container">
                <div className="wsl-wrapper">
                  <div className="wsl-content-wrapper">
                    <div className="wsl-header">
                      <img className="wsl-logo" src={wslLogo} alt="WSL Logo" />
                      <span className="wsl-title">WSL</span>
                    </div>
                    <p className="wsl-description">
                      工具箱和学科培训的依赖项，请先启用wsl，安装podman，再使用工具箱和学科培训
                    </p>
                    <div className="wsl-status-container">
                      {wslChecking ? (
                        <Button
                          type="default"
                          className="wsl-status-button"
                          loading={true}
                        >
                          检查中...
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          className={`wsl-status-button ${vTReady && isWSLInstalled ? 'installed' : 'not-installed'}`}
                        >
                          {wslStatusText()}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="wsl-buttons-wrapper">
                    <Popconfirm
                      title="启动WSL"
                      description="确认启用WSL吗？启用完成后可能需要重启计算机才能生效。"
                      onConfirm={() => handleCmdAction('install', 'WSL')}
                      okText="启用"
                      cancelText="取消"
                    >
                      <Button
                        className="wsl-button install"
                        loading={
                          wslLoading &&
                          wslOperation.action === 'install' &&
                          wslOperation.service === 'WSL'
                        }
                        disabled={
                          !vTReady ||
                          wslChecking ||
                          isWSLInstalled ||
                          (wslLoading &&
                            !(
                              wslOperation.action === 'install' &&
                              wslOperation.service === 'WSL'
                            ))
                        }
                      >
                        <span className="button-text">启用WSL</span>
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="升级WSL"
                      description={
                        <div>
                          <div>您当前的WSL版本是 {wslVersion || '未知'}</div>
                          <div>确认升级WSL吗？</div>
                        </div>
                      }
                      onConfirm={() => handleCmdAction('update', 'WSL')}
                      okText="升级"
                      cancelText="取消"
                    >
                      <Button
                        className="wsl-button upgrade"
                        loading={
                          wslLoading &&
                          wslOperation.action === 'update' &&
                          wslOperation.service === 'WSL'
                        }
                        disabled={
                          !isWSLInstalled ||
                          wslChecking ||
                          (wslLoading &&
                            !(
                              wslOperation.action === 'update' &&
                              wslOperation.service === 'WSL'
                            ))
                        }
                      >
                        <span className="button-text">升级WSL</span>
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="安装Podman"
                      description={
                        <div>
                          <div>
                            {isPodmanInstalled
                              ? '修改Podman位置'
                              : '安装Podman'}
                            可能需要5分钟时间，实际用时和你的磁盘读写速度有关。
                          </div>
                          <div style={{ color: 'red' }}>
                            提示Docker用户：如果您的电脑上还有Docker软件，请您先手动关闭Docker软件前台和后台程序以避免Docker文件被损坏。安装完成后如果出现无法正常运行Docker的情况，请您重启电脑后再打开Docker。
                          </div>
                        </div>
                      }
                      onConfirm={() => handleCmdAction('move', 'podman')}
                      okText="安装"
                      cancelText="取消"
                    >
                      <Button
                        className="wsl-button change-path"
                        loading={
                          podmanChecking ||
                          (wslOperation.action === 'move' &&
                            wslOperation.service === 'podman')
                        }
                        disabled={
                          !isWSLInstalled ||
                          wslChecking ||
                          (wslLoading &&
                            !(
                              wslOperation.action === 'move' &&
                              wslOperation.service === 'podman'
                            ))
                        }
                      >
                        <span className="button-text">
                          {isPodmanInstalled ? '修改Podman位置' : '安装Podman'}
                        </span>
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="卸载Podman"
                      description="你确定要卸载Podman吗？卸载后再次安装会需要很长时间！"
                      onConfirm={() => handleCmdAction('remove', 'podman')}
                      okText="确认卸载"
                      cancelText="取消"
                    >
                      <Button
                        className="wsl-button uninstall"
                        loading={
                          wslLoading &&
                          wslOperation.action === 'remove' &&
                          wslOperation.service === 'podman'
                        }
                        disabled={
                          !isWSLInstalled ||
                          wslChecking ||
                          (wslLoading &&
                            !(
                              wslOperation.action === 'remove' &&
                              wslOperation.service === 'podman'
                            ))
                        }
                      >
                        <span className="button-text">卸载Podman</span>
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              </div>
            </div>

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
                    <NavLink to="/ai-service" style={{ width: '100%' }}>
                      <Button
                        className="feature-button"
                        block
                        size="large"
                        disabled={!isPodmanInstalled || wslLoading}
                      >
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
                        AI辅助的学科知识培训，学员建档设立目标，帮助补齐技能知识短板
                      </p>
                    </div>
                  </div>
                  <div className="feature-button-container">
                    <Button
                      className="feature-button"
                      block
                      size="large"
                      onClick={openTrainingService}
                      loading={
                        trainingServiceStarting ||
                        trainingServiceShortcut.initing
                      }
                      disabled={
                        trainingServiceRemoving ||
                        !isPodmanInstalled ||
                        wslLoading
                      }
                    >
                      {trainingServiceShortcut.state === '还未安装'
                        ? '安装'
                        : '开始'}
                    </Button>
                    {trainingServiceShortcut.state !== '还未安装' && (
                      <Button
                        className="feature-button uninstall"
                        block
                        size="large"
                        onClick={removeTrainingService}
                        loading={trainingServiceRemoving}
                        disabled={!isPodmanInstalled || wslLoading}
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
      <Modal open={showRebootModal} footer={false} closable={false}>
        已经成功打开windows系统自带WSL组件，需要重启电脑才能进行后续操作，请确保你保存了所有的文件后手动重启电脑
      </Modal>
      <Modal open={needResintallPodman} footer={false} closable={false}>
        检测到您使用过启动器V1版，新版启动器需要卸载启动器V1版的Podman组件，然后重新安装Podman才能正常使用语音功能，请卸载Podman组件
        <br />
        <Button
          className="wsl-button uninstall"
          loading={
            wslLoading &&
            wslOperation.action === 'remove' &&
            wslOperation.service === 'podman'
          }
          disabled={
            !isWSLInstalled ||
            wslChecking ||
            (wslLoading &&
              !(
                wslOperation.action === 'remove' &&
                wslOperation.service === 'podman'
              ))
          }
          onClick={() => handleCmdAction('remove', 'podman')}
        >
          <span className="button-text">卸载Podman</span>
        </Button>
      </Modal>
    </div>
  );
}
