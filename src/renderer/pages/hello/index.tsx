import { Button } from 'antd';
import { NavLink } from 'react-router-dom';
import RightOutlined from "@ant-design/icons"
import icon from './icon.png';
import reader_icon from './reader.png';
import tools_icon from './tools.png';
import llm_icon from './llm.png';
import course_icon from './course.png';
import './index.scss';

export default function Hello() {
   const items = [
    {
      key: 'reader',
      title: '阅读器',
      to: '/obsidian-app',
      icon: reader_icon,
      desc: '基于obsidian的学习资料库管理及相关插件版本管理',
    },
    {
      key: 'toolbox',
      title: '工具箱',
      to: '/ai-service',
      icon: tools_icon,
      desc: '用于集成管理与使用各种AI工具，当前支持文字转语音、语音转文字、PDF2MarkDown一键部署',
    },
    {
      key: 'models',
      title: '大模型',
      to: '/lm-service',
      icon: llm_icon,
      desc: '用于管理本地部署大模型和在线模型平台的API，可一键配置obsidian阅读器copilot插件等API key',
    },
    {
      key: 'course',
      title: '知识课程',
      to: '/course',
      icon: course_icon,
      desc: 'AI辅助的学科知识培训，帮助设定学习目标，补齐技能和知识短板',
    },
  ];

  return (
    <div className="hello-root">
      {/* 右侧纵向按钮：日志导出 */}
      <NavLink to="/log-export" className="side-export">
        日志导出
      </NavLink>

      {/* 头部：Logo + 标题 */}
      <header className="hero">
        <img className="logo" width="120" alt="icon" src={icon} />
        <h1 className="title">欢迎使用AI学习助手</h1>
      </header>

      {/* 四列卡片区 */}
      <main className="feature-grid">
        {items.map((it) => (
          <div className="feature-card" key={it.key}>
            <div className="card-hd">
  <img src={it.icon} alt={it.title} className="card-icon" />
  <span className="card-title">{it.title}</span>
            </div>
            <p className="card-desc">{it.desc}</p>
            <NavLink to={it.to} className="launch-link">
              <Button className="launch-btn" size="large" type="primary">
                启动 <RightOutlined />
              </Button>
            </NavLink>
          </div>
        ))}
      </main>

      {/* 角落信息 */}
            <div style={{ position: 'absolute', left: '10px', bottom: '10px' }}>
        源码版本：
        {__COMMIT_HASH__}
      </div>
      <div style={{ position: 'absolute', right: '10px', bottom: '10px' }}>
        版本号：{__NPM_PACKAGE_VERSION__}
      </div>

      {/* 开发态示例入口 */}
      {process.env.NODE_ENV === 'development' ? (
        <NavLink to="/example" className="dev-link">
          <Button>代码示例页</Button>
        </NavLink>
      ) : null}
    </div>
  );
}
