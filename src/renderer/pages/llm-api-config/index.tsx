import React, { useState, useEffect } from 'react';
import { Button, Form, Input, Select, List, Switch, Card, message, Modal, Space, Typography, Popconfirm, Tag } from 'antd';
import { Link } from 'react-router-dom';
import useConfigs from '../../containers/use-configs';
import { LLMConfig, CustomModel } from '../../../main/configs/type-info';  
import './index.scss';

const { Option } = Select;
const { Text } = Typography;


// 提供商信息配置（参考constant.ts中的ProviderInfo）
const PROVIDER_INFO = {
  openai: {
    label: "OpenAI",
    host: "https://api.openai.com",
    keyManagementURL: "https://platform.openai.com/api-keys",
    testModel: "gpt-4.1",
  },
  "azure openai": {
    label: "Azure OpenAI",
    host: "",
    keyManagementURL: "",
    testModel: "azure-openai",
  },
  anthropic: {
    label: "Anthropic",
    host: "https://api.anthropic.com/",
    keyManagementURL: "https://console.anthropic.com/settings/keys",
    testModel: "claude-3-5-sonnet-latest",
  },
  cohereai: {
    label: "Cohere",
    host: "https://api.cohere.com",
    keyManagementURL: "https://dashboard.cohere.ai/api-keys",
    testModel: "command-r",
  },
  google: {
    label: "Gemini",
    host: "https://generativelanguage.googleapis.com",
    keyManagementURL: "https://makersuite.google.com/app/apikey",
    testModel: "gemini-2.5-flash",
  },
  xai: {
    label: "XAI",
    host: "https://api.x.ai/v1",
    keyManagementURL: "https://console.x.ai",
    testModel: "grok-3",
  },
  openrouterai: {
    label: "OpenRouter",
    host: "https://openrouter.ai/api/v1/",
    keyManagementURL: "https://openrouter.ai/keys",
    testModel: "openai/chatgpt-4o-latest",
  },
  groq: {
    label: "Groq",
    host: "https://api.groq.com/openai",
    keyManagementURL: "https://console.groq.com/keys",
    testModel: "llama3-8b-8192",
  },
  ollama: {
    label: "Ollama",
    host: "http://localhost:11434/",
    keyManagementURL: "",
    testModel: "",
  },
  "lm-studio": {
    label: "LM Studio",
    host: "http://localhost:1234/v1",
    keyManagementURL: "",
    testModel: "",
  },
  "3rd party (openai-format)": {
    label: "OpenAI Format",
    host: "https://api.example.com/v1",
    keyManagementURL: "",
    testModel: "",
  },
  mistralai: {
    label: "Mistral",
    host: "https://api.mistral.ai/v1",
    keyManagementURL: "https://console.mistral.ai/api-keys",
    testModel: "mistral-tiny-latest",
  },
  deepseek: {
    label: "DeepSeek",
    host: "https://api.deepseek.com/",
    keyManagementURL: "https://platform.deepseek.com/api-keys",
    testModel: "deepseek-chat",
  },
};

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure-openai', label: 'Azure OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'lm-studio', label: 'LM Studio' },
//   { value: 'mistralai', label: 'Mistral' },
//   { value: 'groq', label: 'Groq' },
//   { value: 'xai', label: 'XAI' },
//   { value: 'openrouterai', label: 'OpenRouter' },
  { value: '3rd party (openai-format)', label: '自定义 (OpenAI格式)' },
];

const LLMConfig: React.FC = () => {
  const [form] = Form.useForm();
  const { llmConfig, loading, action, testingResult } = useConfigs();
  const [models, setModels] = useState<CustomModel[]>([]);
  const [editingModel, setEditingModel] = useState<CustomModel | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('openai');
  const [showAddForm, setShowAddForm] = useState(false); // 替代弹窗的状态

  // 添加本地状态控制测试结果显示
  const [showTestResult, setShowTestResult] = useState(false);
  const [localTestingResult, setLocalTestingResult] = useState<{success: boolean, message: string} | null>(null);

  useEffect(() => {
    if (llmConfig) {
      setModels(llmConfig.models || []);
    }
  }, [llmConfig]);

  useEffect(() => {
    // 当接收到新的测试结果时更新本地状态
    if (testingResult) {
      setLocalTestingResult(testingResult);
      setShowTestResult(true);
    }
  }, [testingResult]);
  
  const generateModelId = (provider: string, modelName: string) => {
    // 使用提供商和模型名称组合作为唯一ID
    return `${provider}-${modelName}`;
  };
  
  const handleAddModel = () => {
    setEditingModel(null);
    form.resetFields();
    // 设置默认提供商为openai
    form.setFieldsValue({ provider: 'openai' });
    setSelectedProvider('openai');
    // 重置测试相关状态
    setShowTestResult(false);
    setLocalTestingResult(null);
    setShowAddForm(true); // 显示表单而不是弹窗
  };

  const handleEditModel = (model: CustomModel) => {
    setEditingModel(model);
    form.setFieldsValue(model);
    setSelectedProvider(model.provider);
    // 重置测试相关状态
    setShowTestResult(false);
    setLocalTestingResult(null);
    setShowAddForm(true); // 显示表单而不是弹窗
  };

  const handleDeleteModel = (modelId: string) => {
    // 从本地状态中删除模型
    const updatedModels = models.filter(model => model.id !== modelId);
    setModels(updatedModels);
    
    // 直接保存更新后的配置
    const config: LLMConfig = {
      models: updatedModels
    };
    action('set', 'LLM', config);
  };

  const handleProviderChange = (value: string) => {
    setSelectedProvider(value);
    // 设置默认的baseUrl
    const providerInfo = PROVIDER_INFO[value as keyof typeof PROVIDER_INFO];
    if (providerInfo && providerInfo.host) {
      form.setFieldsValue({ baseUrl: providerInfo.host });
    }
  };

  const handleSaveModel = () => {
    form.validateFields().then(values => {

      // 使用提供商和模型名称生成唯一ID
      const modelId = generateModelId(values.provider, values.name);

      const model: CustomModel = {
        ...values,
        id: modelId
      };

      // 检查测试结果是否成功
      if (!localTestingResult  || !localTestingResult.success) {
        message.error('请先测试模型连接并确保测试通过后再保存');
        return;
      }

      let updatedModels;
      if (editingModel) {
        // 更新现有模型
        updatedModels = models.map(m => m.id === editingModel.id ? model : m);
        setModels(updatedModels);
      } else {
        // 检查是否已存在相同ID的模型
        if (models.some(m => m.id === modelId)) {
          message.error('该提供商的此模型已存在，请编辑现有模型或更改模型名称');
          return;
        }
        // 添加新模型
        updatedModels = [...models, model];
        setModels(updatedModels);
      }

      // 直接保存配置到文件
      const config: LLMConfig = {
        models: updatedModels
      };
      action('set', 'LLM', config);

      setShowAddForm(false); // 隐藏表单
      form.resetFields();
      // 重置测试相关状态
      setShowTestResult(false);
      setLocalTestingResult(null);
    }).catch(errorInfo => {
        // 表单验证失败时的处理
        console.error('表单验证失败:', errorInfo);
    });
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    form.resetFields();
    // 重置测试相关状态
    setShowTestResult(false);
    setLocalTestingResult(null);
  };

  const handleTestConnection = async () => {

    form.validateFields().then(values => {

      // 使用提供商和模型名称生成唯一ID
      const modelId = generateModelId(values.provider, values.name);

      const model: CustomModel = {
        ...values,
        id: modelId
      };
      
      // 调用测试连接功能前重置loading状态
      setShowTestResult(false);
      setLocalTestingResult(null);
      // 调用测试连接功能
      action('testConnection', 'LLM', model);
    }).catch(errorInfo => {
      message.error('请先填写必填字段再测试连接');
    });
  };

  // 新增处理批量同步所有API key的函数
  const handleSyncAllApiKeys = () => {
    // 确保有配置可以同步
    if (!llmConfig || !llmConfig.models || llmConfig.models.length === 0) {
      message.warning('请先配置至少一个大语言模型');
      return;
    }
    
    // 发送批量同步请求
    action('syncAllApiKeys', 'copilot', { llmConfig });
  };

  // 添加模型表单组件
  const ModelForm = (
    <Card 
      title={editingModel ? "编辑模型" : "添加模型"}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="模型名称"
          rules={[{ required: true, message: '请输入模型名称' }]}
        >
          <Input placeholder="例如: gpt-4, claude-2" />
        </Form.Item>

        <Form.Item
          name="displayName"
          label="显示名称"
        >
          <Input placeholder="可选的显示名称" />
        </Form.Item>

        <Form.Item
          name="provider"
          label="提供商"
          rules={[{ required: true, message: '请选择提供商' }]}
        >
          <Select 
            placeholder="选择提供商" 
            onChange={handleProviderChange}
          >
            {PROVIDERS.map(provider => (
              <Option key={provider.value} value={provider.value}>
                {provider.label}
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* 显示提供商的Key管理URL */}
        {selectedProvider && PROVIDER_INFO[selectedProvider as keyof typeof PROVIDER_INFO]?.keyManagementURL && (
          <Form.Item label="API密钥管理地址">
            <Text copyable>
              {PROVIDER_INFO[selectedProvider as keyof typeof PROVIDER_INFO].keyManagementURL}
            </Text>
          </Form.Item>
        )}

        <Form.Item
          name="baseUrl"
          label="API地址"
        >
          <Input placeholder="例如: https://api.openai.com/v1" />
        </Form.Item>

        <Form.Item
          name="apiKey"
          label="API密钥"
        >
          <Input.Password placeholder="请输入API密钥（可选）" />
        </Form.Item>

        <Form.Item
          name="isEmbeddingModel"
          label="嵌入模型"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item label="连接测试">
          <Space>
            <Button 
              onClick={handleTestConnection}
              loading={loading && !showTestResult}
            >
              测试连接
            </Button>
            {showTestResult && localTestingResult &&(
              localTestingResult.success ? 
              <Text type="success">测试通过</Text> : 
              <Text type="danger">测试失败: {localTestingResult.message}</Text>
            )}
          </Space>
        </Form.Item>
        
        <Form.Item>
          <Space>
            <Button type="primary" onClick={handleSaveModel}>
              保存
            </Button>
            <Button onClick={handleCancelForm}>
              取消
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );

  return (
    <div className="llm-api-config">
      <Card title="大语言模型API配置" extra={
        <Link to="/lm-service">
          <Button>返回</Button>
        </Link>
      }>
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" onClick={handleAddModel}>
            添加模型
          </Button>
          {/* 新增批量同步API key按钮 */}
          <Button 
            style={{ marginLeft: 16 }}
            onClick={handleSyncAllApiKeys}
          >
            同步Obsidian中ala-copilot插件的API key
          </Button>
        </div>

        {/* 显示添加/编辑表单 */}
        {showAddForm && ModelForm}

        {models.length === 0 && !showAddForm ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Text type="secondary">暂无配置的模型，请点击"添加模型"按钮添加</Text>
          </div>
        ) : (
          <List
            dataSource={models}
            renderItem={model => (
              <List.Item
                actions={[
                  <Button 
                    onClick={() => handleEditModel(model)}
                    size="small"
                  >
                    编辑
                  </Button>,
                  <Popconfirm
                    title="确认删除模型"
                    description={`确定要删除模型 "${model.displayName || model.name}" 吗？`}
                    onConfirm={() => handleDeleteModel(model.id || '')}
                    okText="确认"
                    cancelText="取消"
                  >
                    <Button 
                      danger
                      size="small"
                    >
                      删除
                    </Button>
                  </Popconfirm>
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      显示名称：{model.displayName || model.name}
                      <Tag style={{ marginLeft: 8 }} color={model.isEmbeddingModel ? 'blue' : 'green'}>
                        {model.isEmbeddingModel ? '嵌入模型' : '对话模型'}
                      </Tag>
                    </span>
                  }
                  description={
                    <div>
                      <div>提供商: {model.provider}</div>
                      <div>模型: {model.name}</div>
                      {model.baseUrl && <div>API地址: {model.baseUrl}</div>}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
};

export default LLMConfig;