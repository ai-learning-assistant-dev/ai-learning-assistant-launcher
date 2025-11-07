import { Button, message, Space, Modal } from 'antd';
import { NavLink } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react'; // 添加 useRef 导入
import obsidianLogo from './2023_Obsidian_logo.png';
import toolsIcon from './Tools_Icon.png';
import llmIcon from './LLM_Icon.png';
import heroImage from './Frame 2.png';
import welcomeImage from './Welcome.png';
// 添加新的图片导入
import aiLearningAssistant1 from './AILearningAssistant1.png';
import aiLearningAssistant2 from './AILearningAssistant2.png';
import qrCodeImage from './QR_code_image.png'; // 新增二维码图片导入
import subjectIcon from './subject_icon.png'; // 新增学科培训图标导入
import './index.scss';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useLogContainer } from '../../containers/log-container';

export default function Hello() {
  // 使用新的日志容器
  const { openLogsDirectory, setupLogListener } = useLogContainer();
  
  // 添加二维码模态框的状态
  const [isModalVisible, setIsModalVisible] = useState(false);

  // 添加缩放状态
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // 设置监听器
  useEffect(() => {
    const cancel = setupLogListener(
      () => {
        message.success('已打开日志目录，请在文件资源管理器中查看和复制launcher.log日志文件');
      },
      (error) => {
        message.error(`无法打开日志目录: ${error}`);
      }
    );
    
    return () => {
      if (cancel) cancel();
    };
  }, [setupLogListener]);

  // 轮播图状态
  const [currentSlide, setCurrentSlide] = useState(0);
  
  // 轮播图数据
  const slides = [
    {
      content: <img src={heroImage} alt="Hero" className="hero-image-slide" />
    },
    {
    content: <img src={aiLearningAssistant1} alt="AILearningAssistant 1" className="hero-image-slide" />
    },
    {
      content: <img src={aiLearningAssistant2} alt="AILearningAssistant 2" className="hero-image-slide" />
    }
  ];

  // 自动轮播定时器引用
  const slideInterval = useRef<NodeJS.Timeout | null>(null);

  // 清除定时器的函数
  const clearSlideInterval = () => {
    if (slideInterval.current) {
      clearInterval(slideInterval.current);
      slideInterval.current = null;
    }
  };

  // 开始自动轮播
  const startAutoSlide = () => {
    clearSlideInterval();
    slideInterval.current = setInterval(() => {
      setCurrentSlide(prev => (prev === slides.length - 1 ? 0 : prev + 1));
    }, 5000); // 每5秒切换一次
  };

  // 下一张图片
  const nextSlide = () => {
    setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    // 重置自动轮播计时器
    startAutoSlide();
  };

  // 上一张图片
  const prevSlide = () => {
    setCurrentSlide((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
    // 重置自动轮播计时器
    startAutoSlide();
  };

  // 手动切换到指定图片
  const goToSlide = (index: number) => {
    setCurrentSlide(index);
    // 重置自动轮播计时器
    startAutoSlide();
  };

  // 处理日志导出
  const handleExportLogs = () => {
    // 使用标准方式调用日志目录打开功能
    openLogsDirectory();
  };

  // 显示二维码模态框
  const showQrCodeModal = () => {
    setIsModalVisible(true);
  };

  // 隐藏二维码模态框
  const handleCancel = () => {
    setIsModalVisible(false);
  };

  // 计算缩放比例
  const calculateScale = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      const containerHeight = containerRef.current.offsetHeight;
      
      // 基准尺寸（设计尺寸）
      const baseWidth = 1400;
      const baseHeight = 1000;
      
      // 计算缩放比例，取较小的值以确保内容完整显示
      const scaleX = containerWidth / baseWidth;
      const scaleY = containerHeight / baseHeight;
      const newScale = Math.min(scaleX, scaleY, 1); // 不放大超过原始尺寸
      
      setScale(newScale);
    }
  };

  // 设置自动轮播效果
  useEffect(() => {
    startAutoSlide();
    
    // 组件卸载时清除定时器
    return () => {
      clearSlideInterval();
    };
  }, []);

  return (
    <div className="hello-root">
      <div className="hello-container">
        <div className="hello-content">
          {/* 固定布局：左侧 Welcome 图片，右侧轮播图 */}
          <div className="hello-header">
            <div className="header-content">
              {/* 左侧固定 Welcome 图片 */}
              <div className="logo-section">
                <div className="logo-container">
                  <img src={welcomeImage} alt="Welcome" />
                </div>
              </div>
              
              {/* 右侧轮播图容器 */}
              <div className="hero-image">
                <div className="carousel-container">
                  {slides.map((slide, index) => (
                    <div key={index} className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}>
                      {slide.content}
                    </div>
                  ))}
                </div>
                
                {/* 底部控制区域 - 指示器和切换按钮在同一行 */}
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
                    <button className="carousel-control-bottom" onClick={prevSlide}>
                      <Space><LeftOutlined /></Space>
                    </button>
                    <button className="carousel-control-bottom" onClick={nextSlide}>
                      <Space><RightOutlined /></Space>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
           
          {/* Features section with 3 cards */}
          <div className="features-section">
            <div className="features-container">
              {/* Obsidian Reader Card */}
              <div className="feature-card">
                <div className="feature-wrapper">
                  <div className="feature-icon-text">
                    <div className="obsidian-logo-container">
                      <img className="obsidian-logo" src={obsidianLogo} alt="Obsidian Logo" />
                    </div>
                    <span className="feature-title">阅读器</span>
                  </div>
                  <p className="feature-description">启动、管理obsidian阅读器仓库和插件</p>
                </div>
                <div className="feature-button-container">
                  <NavLink to="/obsidian-app" style={{ width: '100%' }}>
                    <Button className="feature-button" block size="large">开始</Button>
                  </NavLink>
                </div>
              </div>
              
              {/* AI Tools Card */}
              <div className="feature-card">
                <div className="feature-wrapper">
                  <div className="feature-icon-text">
                    <div className="tools-icon-container">
                      <img className="tools-icon" src={toolsIcon} alt="Tools Icon" />
                    </div>
                    <span className="feature-title">工具箱</span>
                  </div>
                  <p className="feature-description long-description">一站式管理多种实用AI工具，目前包含文字转语音、语音转文字、PDF转MarkDown三大功能，让技术操作变得简单快捷</p>
                </div>
                <div className="feature-button-container">
                  <NavLink to="/ai-service" style={{ width: '100%' }}>
                    <Button className="feature-button" block size="large">开始</Button>
                  </NavLink>
                </div>
              </div>
              
              {/* LLM Card */}
              <div className="feature-card">
                <div className="feature-wrapper">
                  <div className="feature-icon-text">
                    <div className="llm-icon-container">
                      <img className="llm-icon" src={llmIcon} alt="LLM Icon" />
                    </div>
                    <span className="feature-title">大模型</span>
                  </div>
                  <p className="feature-description long-description">统一管理本地与在线AI模型的API，并可轻松为Obsidian Copilot等应用设置密钥，省去繁琐步骤</p>
                </div>
                <div className="feature-button-container">
                  <NavLink to="/lm-service" style={{ width: '100%' }}>
                    <Button className="feature-button" block size="large">开始</Button>
                  </NavLink>
                </div>
              </div>

              {/* Subject Training Card */}
              <div className="feature-card">
                <div className="feature-wrapper">
                  <div className="feature-icon-text">
                    <div className="subject-icon-container">
                      <img className="subject-icon" src={subjectIcon} alt="Subject Icon" />
                    </div>
                    <span className="feature-title">学科培训</span>
                  </div>
                  <div className="feature-description">
                    <p className="description-text">AI辅助的学科知识培训，学员建档设立目标，帮助补齐技能知识短板</p>
                  </div>
                </div>
                <div className="feature-button-container">
                  <Button 
                    className="feature-button" 
                    block 
                    size="large"
                    onClick={() => message.info('即将开放学科培训功能')}
                  >
                    <span>开始</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
          
          {/* Footer with version info and log export */}
          <div className="hello-footer">
            <div className="version-info">
              版本号：{__NPM_PACKAGE_VERSION__}  源码版本：{__COMMIT_HASH__}
            </div>
            <div className="log-export">
              <Button 
                className="status-indicator" 
                onClick={handleExportLogs}
                type="primary"
              >
                <span className="log-text">日志导出</span>
              </Button>
              <Button 
                className="get-help-button" 
                onClick={showQrCodeModal}
              >
                获取帮助
              </Button>
            </div>
          </div>
        </div>
      </div>
      {/* 二维码模态框 */}
      <Modal
        className="qr-modal"
        open={isModalVisible}
        onCancel={handleCancel}
        footer={null}
        centered
      >
        <img className="qr-code-image" src={qrCodeImage} alt="QQ群二维码" />
        <p className="qr-description">扫描二维码加入QQ群，关于AI学习助手，在群中提出你的任何疑问，会有专业人员解答</p>
      </Modal>
    </div>
  );
}