import { useCallback, useState } from 'react';
import { Button, List, notification, Skeleton } from 'antd';
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

  const action = useCallback(
    (action: ActionName, pluginId: ServiceName) => {
      if (loading) {
        notification.warning({
          message: '请等待上一个操作完成后再操作',
          placement: 'topRight',
        });
        return;
      }
      obsidianPluginAction(action, pluginId);
      setOperating({ actionName: action, serviceName: pluginId });
    },
    [obsidianPluginAction, setOperating],
  );

  return (
    <div className="obsidian-plugin">
      <List
        className="obsidian-plugin-list"
        header={
          <div className="header-container">
            <NavLink to="/obsidian-app">
              <Button>返回</Button>
            </NavLink>
          </div>
        }
        bordered
      >
        {obsidianPlugins?.map((plugin) => (
          <List.Item
            key={plugin.id}
            actions={[
              plugin.manageByLauncher && !plugin.isInstalled && (
                <Button
                  type="primary"
                  loading={
                    loading &&
                    operating.serviceName === plugin.id &&
                    operating.actionName === 'install'
                  }
                  onClick={() => action('install', plugin.id as ServiceName)}
                >
                  安装插件
                </Button>
              ),
              plugin.manageByLauncher &&
                plugin.isInstalled &&
                !plugin.isLatest && (
                  <Button
                    loading={
                      loading &&
                      operating.serviceName === plugin.id &&
                      operating.actionName === 'update'
                    }
                    onClick={() => action('update', plugin.id as ServiceName)}
                  >
                    更新插件
                  </Button>
                ),
              plugin.manageByLauncher &&
                plugin.isInstalled &&
                plugin.isLatest &&
                '已经是最新版',
              !plugin.manageByLauncher && '第三方插件',
            ].filter((item) => item)}
          >
            <List.Item.Meta
              title={`${plugin.name}`}
              description={
                `已安装版本 ${plugin.isInstalled ? plugin.version : '---'}` +
                (plugin.manageByLauncher
                  ? ` 最新版本 ${plugin.latestVersion}`
                  : '')
              }
            />
          </List.Item>
        ))}
      </List>
    </div>
  );
}
