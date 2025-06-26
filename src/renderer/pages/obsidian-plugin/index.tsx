import { useCallback, useState } from 'react';
import { Button, List, Skeleton } from 'antd';
import { Link, NavLink, useParams } from 'react-router-dom';
import './index.scss';
import useObsidianPlugin from '../../containers/obsidian-plugin';
import {
  ActionName,
  ServiceName,
} from '../../../main/obsidian-plugin/type-info';

export default function ObsidianPlugin() {
  const { vaultId } = useParams();
  const {
    obsidianPlugins,
    action: obsidianPluginAction,
    loading,
  } = useObsidianPlugin(vaultId);
  const [operating, setOperating] = useState<{
    serviceName: ServiceName;
    actionName: ActionName;
  }>({
    serviceName: 'all',
    actionName: 'install',
  });

  const updateObsidianPlugin = useCallback(
    (pluginId: ServiceName) => {
      obsidianPluginAction('update', pluginId);
      setOperating({ actionName: 'update', serviceName: pluginId });
    },
    [obsidianPluginAction],
  );

  const installObsidianPlugin = useCallback(
    (pluginId: ServiceName) => {
      obsidianPluginAction('install', pluginId);
      setOperating({ actionName: 'install', serviceName: pluginId });
    },
    [obsidianPluginAction],
  );

  return (
    <div className="obsidian-plugin">
      <List
        className="obsidian-plugin-list"
        header={
          <div className="header-container">
            <Button>
              <NavLink to="/obsidian-app">返回</NavLink>
            </Button>
          </div>
        }
        bordered
      >
        {obsidianPlugins?.map((plugin) => (
          <List.Item
            key={plugin.id}
            actions={[
              !plugin.isInstalled && (
                <Button
                  type="primary"
                  loading={
                    loading &&
                    operating.serviceName === plugin.id &&
                    operating.actionName === 'install'
                  }
                  onClick={() =>
                    installObsidianPlugin(plugin.id as ServiceName)
                  }
                >
                  安装插件
                </Button>
              ),
              plugin.isInstalled && (
                <Button
                  loading={
                    loading &&
                    operating.serviceName === plugin.id &&
                    operating.actionName === 'update'
                  }
                  onClick={() => updateObsidianPlugin(plugin.id as ServiceName)}
                >
                  更新插件
                </Button>
              ),
            ].filter((item) => item)}
          >
            <List.Item.Meta
              title={`${plugin.name}`}
              description={plugin.version}
            />
          </List.Item>
        ))}
      </List>
    </div>
  );
}
