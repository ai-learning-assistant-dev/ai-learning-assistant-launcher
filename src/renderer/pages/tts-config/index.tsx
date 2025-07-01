import { Button, Checkbox, Space, message } from 'antd';
import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import useConfigs from '../../containers/use-configs';
import useDocker from '../../containers/use-docker';
import ContainerLogs from '../../containers/container-logs';
import './index.scss';

export default function TTSConfig() {
  const {
    containerConfig,
    loading: configsLoading,
    action: configsAction,
  } = useConfigs();
  const { loading: dockerLoading, action: dockerAction } = useDocker();
  
  const [forceNvidia, setForceNvidia] = useState(false);
  const [forceCPU, setForceCPU] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // 从配置中读取初始状态
  useEffect(() => {
    if (containerConfig?.TTS?.gpuConfig) {
      setForceNvidia(containerConfig.TTS.gpuConfig.forceNvidia || false);
      setForceCPU(containerConfig.TTS.gpuConfig.forceCPU || false);
      setHasChanges(false);
    }
  }, [containerConfig]);

  // 处理GPU配置变更
  const handleGPUConfigChange = (type: 'nvidia' | 'cpu', checked: boolean) => {
    if (type === 'nvidia') {
      setForceNvidia(checked);
      setForceCPU(false);
    } else {
      setForceCPU(checked);
      setForceNvidia(false);
    }
    setHasChanges(true);
  };

  // 保存配置
  const handleSaveConfig = () => {
    configsAction('update', 'container', {
      forceNvidia: forceNvidia,
      forceCPU: forceCPU,
    });
    setHasChanges(false);
    message.success('配置已保存，如需生效请重启TTS服务');
  };

  // 返回按钮处理
  const handleBack = () => {
    if (hasChanges) {
      handleSaveConfig();
    }
  };

  return (
    <div className="tts-config">
      <div className="header-container">
        <NavLink to="/ai-service" onClick={handleBack}>
          <Button>返回</Button>
        </NavLink>
        {hasChanges && (
          <Button 
            type="primary" 
            onClick={handleSaveConfig}
            loading={configsLoading}
            style={{ marginLeft: '10px' }}
          >
            保存配置
          </Button>
        )}
      </div>
      
      <div className="gpu-config-section">
        <h3>TTS 模型选择</h3>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
          默认根据电脑信息自动选择，如果需要手动选择，请勾选以下选项
        </p>
        <Space direction="vertical" size="middle">
          <Checkbox
            checked={forceNvidia}
            onChange={(e) => handleGPUConfigChange('nvidia', e.target.checked)}
            disabled={configsLoading}
          >
            强制使用N卡
          </Checkbox>
          <Checkbox
            checked={forceCPU}
            onChange={(e) => handleGPUConfigChange('cpu', e.target.checked)}
            disabled={configsLoading}
          >
            强制使用CPU
          </Checkbox>
        </Space>
        {hasChanges && (
          <div style={{ marginTop: '10px', color: '#1890ff', fontSize: '12px' }}>
            * 配置已修改，请点击"保存配置"或"返回"按钮保存更改
          </div>
        )}
      </div>
      
      <ContainerLogs serviceName="TTS" />
    </div>
  );
}
