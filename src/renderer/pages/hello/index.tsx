import { Button } from 'antd';
import { NavLink } from 'react-router-dom';
import icon from './icon.png';
import './index.scss';

export default function Hello() {
  // 触发渲染进程异常的函数
  const triggerRendererError = () => {
    throw new Error('这是一个人工触发的渲染进程异常');
  };

  // 触发主进程异常的函数
  const triggerMainError = () => {
    window.electron?.ipcRenderer.sendMessage('ipc-example', 'query', 'service1', 'testMainError', '这是一个人工触发的主进程异常');
  };

  return (
    <div className="hello-root">
      <div className="Hello">
        <img width="200" alt="icon" src={icon} />
      </div>
      <h1>欢迎使用AI学习助手</h1>
      <div style={{ position: 'absolute', left: '10px', bottom: '10px' }}>
        源码版本：
        {__COMMIT_HASH__}
      </div>
      <div style={{ position: 'absolute', right: '10px', bottom: '10px' }}>
        版本号：{__NPM_PACKAGE_VERSION__}
      </div>
      <div className="Hello">
        <NavLink to="/obsidian-app">
          <Button>学习助手阅读器</Button>
        </NavLink>
        <br />
        <NavLink to="/ai-service">
          <Button>学习助手工具箱</Button>
        </NavLink>
        <br />
        <NavLink to="/lm-service">
          <Button>AI大模型</Button>
        </NavLink>
        <br />
        {/* 测试按钮 */}
        <Button onClick={triggerRendererError} danger>
          触发渲染进程异常
        </Button>
        <br />
        <Button onClick={triggerMainError} danger>
          触发主进程异常
        </Button>
        <br />
        {process.env.NODE_ENV === 'development' ? (
          <NavLink
            to="/example"
            style={{ position: 'absolute', top: 20, left: 20 }}
          >
            <Button>代码示例页</Button>
          </NavLink>
        ) : undefined}
      </div>
    </div>
  );
}
