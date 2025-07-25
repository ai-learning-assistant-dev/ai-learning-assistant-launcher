import { useCallback, useEffect } from 'react';
import { Button, List, Skeleton } from 'antd';
import { Link, NavLink } from 'react-router-dom';
import './index.scss';
import { channel } from '../../../main/cmd/type-info';
import useCmd from '../../containers/use-cmd';
import useConfigs from '../../containers/use-configs';

export default function Showcase() {
  const {
    showcaseConfig,
    action: configsAction,
    loading: configsLoading,
    queryShowcase,
  } = useConfigs();

  useEffect(() => {
    queryShowcase();
  }, [queryShowcase]);

  return (
    <div className="showcase">
      <List
        className="showcase-list"
        header={
          <div className="header-container">
            <NavLink to="/obsidian-app">
              <Button>返回</Button>
            </NavLink>
            <div className="header-actions">
              <Button onClick={() => {}}>导入工作区</Button>
              <NavLink to="/add-workspace">
                <Button type="primary">增加工作区</Button>
              </NavLink>
            </div>
          </div>
        }
        bordered
      >
        {showcaseConfig?.items?.map((item) => (
          <List.Item
            key={item.id}
            actions={[
              <NavLink key={0} to={`/workspace-config/${item.id}`}>
                <Button type="primary">
                  配置工作区
                </Button>
              </NavLink>,
            ]}
          >
            <List.Item.Meta
              title={item.title}
              description={item.description}
            />
          </List.Item>
        ))}
      </List>
    </div>
  );
} 