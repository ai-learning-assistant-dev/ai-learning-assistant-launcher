import { useCallback } from 'react';
import { Button, List, Skeleton } from 'antd';
import { Link, NavLink } from 'react-router-dom';
import './index.scss';
import { channel } from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import useConfigs from '../../containers/use-configs';

export default function ObsidianApp() {
  const { action: cmdAction, loading: cmdLoading } = useCmd();
  const {
    obsidianConfig,
    obsidianVaultConfig,
    action: configsAction,
    loading: configsLoading,
  } = useConfigs();

  const startObsidian = useCallback(() => {
    cmdAction('start', 'obsidianApp');
  }, [cmdAction]);

  const locationObsidian = useCallback(() => {
    configsAction('update', 'obsidianApp');
  }, []);
  return (
    <div className="obsidian-app">
      <List
        className="obsidian-app-list"
        header={
          <div className="header-container">
            <Button>
              <NavLink to="/hello">返回</NavLink>
            </Button>
          </div>
        }
        bordered
      >
        {obsidianVaultConfig?.map((vault) => (
          <List.Item
            key={vault.id}
            actions={[
              <Button key={0}>
                <NavLink to={`/obsidian-plugin/${vault.id}`}>插件情况</NavLink>
              </Button>,
              <Button key={1}>更新插件</Button>,
            ]}
          >
            <List.Item.Meta
              title={`仓库 ${vault.name}`}
              description={vault.path}
            />
          </List.Item>
        ))}
        <List.Item
          actions={[
            <Button key={0} onClick={locationObsidian}>
              定位阅读器
            </Button>,
            <Button key={1} type="primary" onClick={startObsidian}>
              运行阅读器
            </Button>,
          ]}
        >
          <List.Item.Meta
            title={`阅读器主程序`}
            description={obsidianConfig?.obsidianApp?.bin}
          />
        </List.Item>
      </List>
    </div>
  );
}
