import { Button, List } from 'antd';
import { NavLink } from 'react-router-dom';
import useConfigs from '../../containers/use-configs';
import useDocker from '../../containers/use-docker';
import ContainerLogs from '../../containers/container-logs';
import './index.scss';

export default function ASRConfig() {
  const {
    containerConfig,
    loading: configsLoading,
    action: configsAction,
  } = useConfigs();
  const { loading: dockerLoading, action: dockerAction } = useDocker();

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
      <ContainerLogs serviceName="ASR" />
    </div>
  );
}
