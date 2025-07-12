import { useCallback } from 'react';
import { Button, List, Skeleton } from 'antd';
import { Link, NavLink } from 'react-router-dom';
import './index.scss';
import { channel } from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import useConfigs from '../../containers/use-configs';

export default function ObsidianApp() {
  const {
    isInstallObsidian,
    action: cmdAction,
    loading: cmdLoading,
  } = useCmd();
  const {
    obsidianConfig,
    obsidianVaultConfig,
    action: configsAction,
    loading: configsLoading,
  } = useConfigs();

  return (
    <div className="obsidian-app">
      <List
        className="obsidian-app-list"
        header={
          <div className="header-container">
            <NavLink to="/hello">
              <Button>返回</Button>
            </NavLink>
          </div>
        }
        bordered
      >
        {obsidianVaultConfig?.map((vault) => (
          <List.Item
            key={vault.id}
            actions={[
              <NavLink key={0} to={`/obsidian-plugin/${vault.id}`}>
                <Button>插件情况</Button>
              </NavLink>,
              isInstallObsidian && (
                <Button
                  key={1}
                  onClick={() => cmdAction('start', 'obsidianApp', vault.id)}
                >
                  用阅读器打开
                </Button>
              ),
            ].filter((item) => item)}
          >
            <List.Item.Meta
              title={`仓库 ${vault.name}`}
              description={vault.path}
            />
          </List.Item>
        ))}
        <List.Item
          actions={[
            !isInstallObsidian && (
              <Button
                key={0}
                onClick={() => cmdAction('install', 'obsidianApp')}
              >
                安装阅读器
              </Button>
            ),
            <Button
              key={1}
              onClick={() => configsAction('update', 'obsidianApp')}
            >
              {isInstallObsidian ? '重新定位阅读器' : '定位阅读器'}
            </Button>,
            isInstallObsidian && (
              <Button
                key={2}
                type="primary"
                onClick={() => cmdAction('start', 'obsidianApp')}
              >
                运行阅读器
              </Button>
            ),
          ].filter((item) => item)}
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
