import { Button, List } from 'antd';
import { NavLink } from 'react-router-dom';
import useConfigs from '../../containers/use-configs';

export default function asrConfig() {
  const {
    containerConfig,
    loading: configsLoading,
    action: configsAction,
  } = useConfigs();
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
