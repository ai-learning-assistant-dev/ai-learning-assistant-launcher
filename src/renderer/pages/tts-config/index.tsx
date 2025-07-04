import { Button, Checkbox, Space, message, Input, Card } from 'antd';
import { NavLink } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import {
  LeftOutlined,
  RightOutlined,
  SaveOutlined,
  DeleteOutlined,
  PlusOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import useConfigs from '../../containers/use-configs';
import useDocker from '../../containers/use-docker';
import ContainerLogs from '../../containers/container-logs';
import { VoiceConfig } from '../../../main/configs/type-info';
import './index.scss';

const { TextArea } = Input;

export default function TTSConfig() {
  const {
    containerConfig,
    voiceConfig,
    loading: configsLoading,
    action: configsAction,
    queryVoice,
  } = useConfigs();
  const [forceNvidia, setForceNvidia] = useState(false);
  const [forceCPU, setForceCPU] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // 语音配置相关状态
  const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfig[]>([]);
  const [voiceConfigsLoading, setVoiceConfigsLoading] = useState(false);
  const [voiceConfigsChanged, setVoiceConfigsChanged] = useState(false);
  const [currentModel, setCurrentModel] = useState<'gpu' | 'cpu'>('gpu'); // 当前选择的模型
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 从配置中读取初始状态
  useEffect(() => {
    if (containerConfig?.TTS?.gpuConfig) {
      setForceNvidia(containerConfig.TTS.gpuConfig.forceNvidia || false);
      setForceCPU(containerConfig.TTS.gpuConfig.forceCPU || false);
      setHasChanges(false);
    }
  }, [containerConfig]);

  // 加载语音配置
  useEffect(() => {
    loadVoiceConfigs();
  }, []);

  // 当voiceConfig更新时，同步到本地状态
  useEffect(() => {
    if (voiceConfig?.voices) {
      setVoiceConfigs([...voiceConfig.voices]);
      setVoiceConfigsChanged(false);
    }
  }, [voiceConfig]);

  const loadVoiceConfigs = async () => {
    setVoiceConfigsLoading(true);
    try {
      queryVoice(currentModel);
    } catch (error) {
      message.error('加载语音配置失败');
      console.error('Error loading voice configs:', error);
    } finally {
      setVoiceConfigsLoading(false);
    }
  };

  // 切换模型类型
  const handleModelSwitch = (modelType: 'gpu' | 'cpu') => {
    if (modelType !== currentModel) {
      setCurrentModel(modelType);
      // 切换模型时重新加载配置
      setVoiceConfigsLoading(true);
      try {
        queryVoice(modelType);
      } catch (error) {
        message.error('加载语音配置失败');
        console.error('Error loading voice configs:', error);
      } finally {
        setVoiceConfigsLoading(false);
      }
    }
  };

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
      containerName: 'TTS',
      forceNvidia: forceNvidia,
      forceCPU: forceCPU,
    });
    setHasChanges(false);
  };

  // 返回按钮处理
  const handleBack = () => {
    if (hasChanges) {
      handleSaveConfig();
    }
  };

  // 语音配置相关函数
  const handleVoiceConfigChange = (
    index: number,
    field: keyof VoiceConfig,
    value: string,
  ) => {
    const newConfigs = [...voiceConfigs];
    newConfigs[index] = { ...newConfigs[index], [field]: value };
    setVoiceConfigs(newConfigs);
    setVoiceConfigsChanged(true);
  };

  const handleAddVoice = () => {
    const newVoice: VoiceConfig = {
      name: '新语音',
      description: '语音描述',
      filename: currentModel === 'gpu' ? 'new_voice.wav' : 'new_voice.pt',
      text: currentModel === 'gpu' ? '语音对应文本' : undefined,
      language: 'Chinese',
    };
    setVoiceConfigs([...voiceConfigs, newVoice]);
    setVoiceConfigsChanged(true);
  };

  const handleDeleteVoice = (index: number) => {
    const newConfigs = voiceConfigs.filter((_, i) => i !== index);
    setVoiceConfigs(newConfigs);
    setVoiceConfigsChanged(true);
  };

  const handleSaveVoiceConfigs = async () => {
    setVoiceConfigsLoading(true);
    try {
      configsAction('update', 'TTS', {
        config: { voices: voiceConfigs },
        modelType: currentModel,
      });
      setVoiceConfigsChanged(false);
      message.success('语音配置已保存');
    } catch (error) {
      message.error('保存语音配置失败');
      console.error('Error saving voice configs:', error);
    } finally {
      setVoiceConfigsLoading(false);
    }
  };

  // 滚动控制
  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -320, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 320, behavior: 'smooth' });
    }
  };

  // 打开voices文件夹
  const handleOpenVoicesFolder = () => {
    try {
      // 使用configs通道的update动作来打开voices文件夹
      configsAction('openConfigFolder', 'TTS', { modelType: currentModel });
    } catch (error) {
      message.error('打开voices文件夹失败');
      console.error('Error opening voices folder:', error);
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

      <div className="voice-config-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3>语音配置管理</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              type={currentModel === 'gpu' ? 'primary' : 'default'}
              onClick={() => handleModelSwitch('gpu')}
              disabled={voiceConfigsLoading}
            >
              N卡 (index-tts)
            </Button>
            <Button
              type={currentModel === 'cpu' ? 'primary' : 'default'}
              onClick={() => handleModelSwitch('cpu')}
              disabled={voiceConfigsLoading}
            >
              CPU (Kokoro)
            </Button>
          </div>
        </div>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
          管理文字转服务的音色配置，可以任意的添加、编辑和删除音色选项卡。
          {currentModel === 'cpu' && ' (CPU模型不支持text字段)'}
        </p>
        
        <div style={{ 
          background: '#f0f8ff', 
          border: '1px solid #d6e4ff', 
          borderRadius: '6px', 
          padding: '12px', 
          marginBottom: '16px',
          fontSize: '13px',
          color: '#1890ff'
        }}>
          💡 实际加载的语音模型可从下方日志中查看
        </div>
        
        <div className="voice-config-container">
          <div className="voice-config-scroll" ref={scrollContainerRef}>
            {voiceConfigs.slice().reverse().map((voice, index) => (
              <div key={voiceConfigs.length - 1 - index} className="voice-card">
                <div className="voice-card-header">
                  <div className="voice-card-title">语音 {voiceConfigs.length - index}</div>
                  <div className="voice-card-actions">
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteVoice(voiceConfigs.length - 1 - index)}
                      danger
                    />
                  </div>
                </div>
                
                <div className="voice-config-item">
                  <label className="config-label">名称 (name)</label>
                  <Input
                    className="config-input"
                    value={voice.name}
                    onChange={(e) => handleVoiceConfigChange(voiceConfigs.length - 1 - index, 'name', e.target.value)}
                    placeholder="输入语音名称"
                  />
                </div>
                
                <div className="voice-config-item">
                  <label className="config-label">描述 (description)</label>
                  <Input
                    className="config-input"
                    value={voice.description}
                    onChange={(e) => handleVoiceConfigChange(voiceConfigs.length - 1 - index, 'description', e.target.value)}
                    placeholder="输入语音描述"
                  />
                </div>
                
                <div className="voice-config-item">
                  <label className="config-label">文件名 (filename)</label>
                  <Input
                    className="config-input"
                    value={voice.filename}
                    onChange={(e) => handleVoiceConfigChange(voiceConfigs.length - 1 - index, 'filename', e.target.value)}
                    placeholder="输入文件名"
                  />
                </div>
                
                <div className="voice-config-item">
                  <label className="config-label">语音对应文本 (text)</label>
                  <TextArea
                    className="config-input"
                    value={voice.text || ''}
                    onChange={(e) => handleVoiceConfigChange(voiceConfigs.length - 1 - index, 'text', e.target.value)}
                    placeholder="输入语音对应文本"
                    rows={2}
                    disabled={currentModel === 'cpu'}
                  />
                  {currentModel === 'cpu' && (
                    <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                      CPU模型不支持text字段
                    </div>
                  )}
                </div>
                
                <div className="voice-config-item">
                  <label className="config-label">语言 (language)</label>
                  <Input
                    className="config-input"
                    value={voice.language}
                    onChange={(e) => handleVoiceConfigChange(voiceConfigs.length - 1 - index, 'language', e.target.value)}
                    placeholder="输入语言"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="voice-config-actions">
          <div className="scroll-controls">
            <Button
              icon={<LeftOutlined />}
              onClick={scrollLeft}
              disabled={voiceConfigsLoading}
            >
              向左滚动
            </Button>
            <Button
              icon={<RightOutlined />}
              onClick={scrollRight}
              disabled={voiceConfigsLoading}
            >
              向右滚动
            </Button>
          </div>
          
          <div>
            <Button
              icon={<FolderOpenOutlined />}
              onClick={handleOpenVoicesFolder}
              disabled={voiceConfigsLoading}
              style={{ marginRight: '8px' }}
            >
              导入语音
            </Button>
            <Button
              icon={<PlusOutlined />}
              onClick={handleAddVoice}
              disabled={voiceConfigsLoading}
              style={{ marginRight: '8px' }}
            >
              添加语音
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveVoiceConfigs}
              loading={voiceConfigsLoading}
              disabled={!voiceConfigsChanged}
            >
              保存语音配置
            </Button>
          </div>
        </div>
        
        {voiceConfigsChanged && (
          <div style={{ marginTop: '10px', color: '#1890ff', fontSize: '12px' }}>
            * 语音配置已修改，请点击"保存语音配置"按钮保存更改
          </div>
        )}
      </div>

      <ContainerLogs serviceName="TTS" />
    </div>
  );
}
