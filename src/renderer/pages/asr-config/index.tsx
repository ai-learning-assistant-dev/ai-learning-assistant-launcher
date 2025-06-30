import { Button, List } from 'antd';
import { NavLink } from 'react-router-dom';

export default function asrConfig() {
  return (
    <div className="asr-config">
      <List
        className="asr-config-list"
        header={
          <div className="header-container">
            <NavLink to="/ai-service">
              <Button>返回</Button>
            </NavLink>
          </div>
        }
      />
    </div>
  );
}
