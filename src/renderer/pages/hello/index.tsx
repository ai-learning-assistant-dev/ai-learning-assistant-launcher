import { Button } from 'antd';
import { NavLink } from 'react-router-dom';
import icon from './icon.svg';
import './index.scss';

export default function Hello() {
  return (
    <div className="hello-root">
      <div className="Hello">
        <img width="200" alt="icon" src={icon} />
      </div>
      <h1>欢迎使用AI学习助手</h1>
      <div className="Hello">
        <Button><NavLink to="/obsidian-app">学习助手阅读器</NavLink></Button>
        <br />
        <Button>
          <NavLink to="/ai-service">AI功能设置</NavLink>
        </Button>
      </div>
    </div>
  );
}
