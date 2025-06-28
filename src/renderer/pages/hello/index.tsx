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
        <NavLink to="/obsidian-app">
          <Button>学习助手阅读器</Button>
        </NavLink>
        <br />
        <NavLink to="/ai-service">
          <Button>学习助手工具箱</Button>
        </NavLink>
      </div>
    </div>
  );
}
