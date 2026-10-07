import React, { useState, useEffect } from 'react';
import { Button, Form, Input, Select, List, Switch, Card, message, Modal, Space, Typography, Popconfirm, Tag, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import useConfigs from '../../containers/use-configs';
import { LLMConfig, CustomModel } from '../../../main/configs/type-info';
import type { FreeModelSummary } from '../../../main/llm-free/type-info';
import ZenFreeProviderConfig, { useZenFreeProvider, STATE_META } from './ZenFreeProviderConfig';
import './index.scss';

const { Option } = Select;
const { Text } = Typography;

// Zen 免费模型的「嵌入模型 / 对话模型」分类字典：按模型名称匹配。
// 未命中（字典中未明确说明）则不打该标签。
// TODO: 如果Zen 提供了Model的类型那么应该自动获取它的类型而不是手工预先填写
const ZEN_MODEL_ROLE: Record<string, 'embed' | 'chat'> = {
  'jev-1.13-free': 'chat',
};
const zenModelRole = (m: FreeModelSummary): 'embed' | 'chat' | null =>
  ZEN_MODEL_ROLE[m.id] ?? null;


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

  // 免密免费模型（Zen free lane）：数据/动作集合，与主列表、弹窗配置面板共享同一份状态
  const zenFree = useZenFreeProvider();
  const [showZenConfig, setShowZenConfig] = useState(false);

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
    // 确保有配置可以同步：用户手工模型 或 Zen 免费模型 任一存在即可
    const hasUserModels = (llmConfig?.models?.length ?? 0) > 0;
    const hasFreeModels = (zenFree.status?.models?.length ?? 0) > 0;
    if (!hasUserModels && !hasFreeModels) {
      message.warning('请先配置至少一个大语言模型');
      return;
    }

    // 免费模型免密，不在 llmConfig.models 里；同步进 dsh 时单独带上它的模型目录
    // 与本地代理配置（baseUrl + 代理密钥），让下游直接走 127.0.0.1 代理。
    const freeForward =
      zenFree.config?.enabled ? zenFree.config.forward : undefined;
    const freeModelsPayload = freeForward
      ? (zenFree.status?.models ?? [])
      : [];

    // 发送批量同步请求
    action('syncAllApiKeys', 'copilot', {
      llmConfig,
      freeModels: freeModelsPayload,
      freeForward: freeForward
        ? { port: freeForward.port, key: freeForward.key }
        : undefined,
    });
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
      <Card 
        title={
          <Link to="/lm-service">
            <Button>返回</Button>
          </Link>
        }
        extra={"大语言模型API配置"}
      >
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" onClick={handleAddModel}>
            添加模型
          </Button>
          {/* 批量同步API key：Obsidian 的 ala-copilot 插件 + DeepSeek Harness */}
          <Button 
            style={{ marginLeft: 16 }}
            onClick={handleSyncAllApiKeys}
            title="把下面配置的模型和 API key 同步到 Obsidian 的 ala-copilot 插件，以及 DeepSeek Harness（dsh）"
          >
            同步API key（Obsidian copilot / DeepSeek Harness）
          </Button>
          {/* 免密免费模型（Zen free lane）：以弹窗形式展开配置面板，默认不打断主列表浏览 */}
          <Button
            style={{ marginLeft: 16 }}
            onClick={() => setShowZenConfig(true)}
            icon={!zenFree.config ? undefined : (
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: !zenFree.config.enabled
                    ? '#8c8c8c'
                    : zenFree.status?.running
                      ? '#52c41a'
                      : '#f5222d',
                }}
              />
            )}
          >
            Zen 公开免费模型本地代理配置
          </Button>
        </div>

        {/* 显示添加/编辑表单 */}
        {showAddForm && ModelForm}

        {(() => {
          // 合并：用户手工添加的模型 + Zen 免费模型，统一复用同一个列表表达。
          // 免费模型为只读展示（仅显示可用状态），不可编辑/删除，由插件自动维护。
          const freeModels = zenFree.status?.models ?? [];
          const modelRows: Array<
            | { kind: 'user'; model: CustomModel }
            | { kind: 'free'; model: FreeModelSummary }
          > = [
            ...models.map((m) => ({ kind: 'user' as const, model: m })),
            ...freeModels.map((m) => ({ kind: 'free' as const, model: m })),
          ];

          if (modelRows.length === 0 && !showAddForm) {
            return (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Text type="secondary">
                  暂无配置的模型，请点击"添加模型"按钮添加；启用「Zen 公开免费模型本地代理配置」后，免费模型也会显示在此列表中。
                </Text>
              </div>
            );
          }

          const renderFree = (m: FreeModelSummary) => {
            const meta = STATE_META[m.state] ?? STATE_META.unknown;
            const role = zenModelRole(m);
            const roleTag = role ? (
              <Tag style={{ marginLeft: 8 }} color={role === 'embed' ? 'blue' : 'green'}>
                {role === 'embed' ? '嵌入模型' : '对话模型'}
              </Tag>
            ) : null;
            // 本地转发代理地址：下游工具把 baseUrl 指向 http://127.0.0.1:<port>/v1
            const fwdPort = zenFree.status?.port ?? zenFree.config?.forward.port;
            const apiBase = fwdPort ? `http://127.0.0.1:${fwdPort}/v1` : '（代理未启用/未运行）';
            return (
              <List.Item actions={[<Tag key="state" color={meta.color}>{meta.label}</Tag>]}>
                <List.Item.Meta
                  title={
                    <span>
                      显示名称：{m.name}
                      <Tooltip title="由插件自动添加并配置，不可编辑或删除；可用状态随「Zen 公开免费模型本地代理配置」中的刷新而变化">
                        <Tag color="purple" style={{ marginLeft: 8 }}>Zen 免费</Tag>
                      </Tooltip>
                      {roleTag}
                    </span>
                  }
                  description={
                    <div>
                      <div>提供商: Zen 免费</div>
                      <div>模型ID: {m.id}</div>
                      <div>API地址: {apiBase}</div>
                      <div style={{ marginTop: 2 }}>
                        上下文 {(m.contextWindow / 1024).toFixed(0)}K · 输出上限 {(m.maxOutput / 1024).toFixed(0)}K
                        {m.vision ? ' · 视觉' : ''}
                        {m.reasoning ? ' · 推理' : ''}
                      </div>
                    </div>
                  }
                />
              </List.Item>
            );
          };

          return (
            <List
              dataSource={modelRows}
              renderItem={(row) =>
                row.kind === 'user' ? (
                  <List.Item
                    actions={[
                      <Button key="edit" onClick={() => handleEditModel(row.model)} size="small">编辑</Button>,
                      <Popconfirm
                        key="del"
                        title="确认删除模型"
                        description={`确定要删除模型 "${row.model.displayName || row.model.name}" 吗？`}
                        onConfirm={() => handleDeleteModel(row.model.id || '')}
                        okText="确认"
                        cancelText="取消"
                      >
                        <Button danger size="small">删除</Button>
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <span>
                          显示名称：{row.model.displayName || row.model.name}
                          <Tag style={{ marginLeft: 8 }} color={row.model.isEmbeddingModel ? 'blue' : 'green'}>
                            {row.model.isEmbeddingModel ? '嵌入模型' : '对话模型'}
                          </Tag>
                        </span>
                      }
                      description={
                        <div>
                          <div>提供商: {row.model.provider}</div>
                          <div>模型ID: {row.model.name}</div>
                          {row.model.baseUrl && <div>API地址: {row.model.baseUrl}</div>}
                        </div>
                      }
                    />
                  </List.Item>
                ) : (
                  renderFree(row.model)
                )
              }
            />
          );
        })()}

        {/* 免密免费模型（Zen free lane）：配置面板以弹窗形式展开，不打断主列表浏览 */}
        <Modal
          title={
            <Space size={6}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: !zenFree.config
                    ? '#8c8c8c'
                    : !zenFree.config.enabled
                      ? '#8c8c8c'
                      : zenFree.status?.running
                        ? '#52c41a'
                        : '#f5222d',
                }}
              />
              <span>Zen 公开免费模型本地代理配置</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {!zenFree.config
                  ? '加载中'
                  : !zenFree.config.enabled
                    ? '未启用'
                    : zenFree.status?.running
                      ? `运行中 · ${zenFree.status?.port ?? zenFree.config.forward.port}`
                      : '已启用但未运行'}
              </Text>
            </Space>
          }
          open={showZenConfig}
          onCancel={() => setShowZenConfig(false)}
          footer={null}
          width={760}
          styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
        >
          <ZenFreeProviderConfig controller={zenFree} embedded />
        </Modal>
      </Card>
    </div>
  );
};

export default LLMConfig;