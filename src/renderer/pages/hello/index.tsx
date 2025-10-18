import { Button, message, Space } from 'antd';
import { NavLink } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react'; // 添加 useRef 导入
import obsidianLogo from './2023_Obsidian_logo.png';
import toolsIcon from './Tools_Icon.png';
import llmIcon from './LLM_Icon.png';
import heroImage from './Frame 2.png';
import welcomeImage from './Welcome.png';
import './index.scss';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useLogContainer } from '../../containers/log-container';

export default function Hello() {
  // 使用新的日志容器
  const { openLogsDirectory, setupLogListener } = useLogContainer();
  
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
      content: <img src={welcomeImage} alt="Welcome" className="welcome-image" />
    },
    {
      content: <img src={heroImage} alt="Hero" className="hero-image-slide" />
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
          {/* 轮播图容器 */}
          <div className="carousel-container">
            {slides.map((slide, index) => (
              <div key={index} className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}>
                {slide.content}
              </div>
            ))}
          </div>

          {/* 底部控制区域 */}
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
              {process.env.NODE_ENV === 'development' && (
                <NavLink
                  to="/example"
                  className="dev-example-link-inline"
                >
                  <Button className="dev-example-button">代码示例页</Button>
                </NavLink>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}