import { Button, List } from 'antd';
import { NavLink } from 'react-router-dom';
import useConfigs from '../../containers/use-configs';
import useDocker from '../../containers/use-docker';

export default function ttsConfig() {
  const {
    containerConfig,
    loading: configsLoading,
    action: configsAction,
  } = useConfigs();
  const { loading: dockerLoading, action: dockerAction } = useDocker();
  return (
    <div className="tts-config">
      <List
        className="tts-config-list"
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
