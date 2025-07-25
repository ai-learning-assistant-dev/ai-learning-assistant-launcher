import { useCallback, useEffect, useState } from 'react';
import { Button, List, Card, Typography } from 'antd';
import { NavLink, useParams } from 'react-router-dom';
import './index.scss';
import useConfigs from '../../containers/use-configs';

const { Title, Paragraph } = Typography;

export default function WorkspaceConfig() {
  const { itemId } = useParams<{ itemId: string }>();
  const {
    showcaseConfig,
    queryShowcase,
  } = useConfigs();
  
  const [currentItem, setCurrentItem] = useState<any>(null);

  useEffect(() => {
    queryShowcase();
  }, [queryShowcase]);

  useEffect(() => {
    if (showcaseConfig?.items && itemId) {
      const item = showcaseConfig.items.find(item => item.id === itemId);
      setCurrentItem(item);
    }
  }, [showcaseConfig, itemId]);

  return (
    <div className="workspace-config">
      <div className="workspace-config-header">
        <NavLink to="/showcase">
          <Button>返回</Button>
        </NavLink>
        <Title level={3}>工作区配置</Title>
      </div>
      
      {currentItem && (
        <Card className="workspace-config-card">
          <Title level={4}>{currentItem.title}</Title>
          <Paragraph>{currentItem.description}</Paragraph>
          
          <div className="workspace-config-actions">
            <Button 
              type="primary" 
              size="large"
              onClick={() => window.open(currentItem.link, '_blank')}
            >
              访问配置页面
            </Button>
          </div>
          
          <div className="workspace-config-link">
            <Paragraph strong>配置链接：</Paragraph>
            <Paragraph copyable={{ text: currentItem.link }}>
              {currentItem.link}
            </Paragraph>
          </div>
        </Card>
      )}
      
      {!currentItem && (
        <Card className="workspace-config-card">
          <Paragraph>未找到对应的配置项</Paragraph>
        </Card>
      )}
    </div>
  );
} 