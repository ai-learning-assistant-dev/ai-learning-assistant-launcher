// NEW_FILE: d:\Project\AILearningAssistant\ai-learning-assistant-launcher\src\renderer\pages\workspace-manage\index.tsx
import React, { useState, useEffect } from 'react';
import { 
  Button, 
  Form, 
  Input, 
  Select, 
  Card, 
  message, 
  TreeSelect,
  Divider,
  Space,
  Tooltip,
  List,
  Modal,
  Typography
} from 'antd';
import { useParams, NavLink } from 'react-router-dom';
import { ArrowLeftOutlined, PlusOutlined, SaveOutlined, UpOutlined, DownOutlined, EditOutlined, FolderAddOutlined } from '@ant-design/icons';
import './index.scss';
import useWorkspace from '../../containers/use-workspace';
import { DirectoryNode, WorkspaceConfig, Persona } from '../../../main/workspace/type-info';

const { Title, Text } = Typography;

// 添加默认配置常量
const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  version: '1.0',
  personas: [{
    id: 'default-persona',
    name: '默认人设',
    prompt: '这是一个示例人设'
  }],
  excludedPaths: []
};

interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
}

export default function WorkspaceManage() {
  const { vaultId } = useParams();
  const [form] = Form.useForm();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);
  const [currentWorkspacePath, setCurrentWorkspacePath] = useState('');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [excludedPaths, setExcludedPaths] = useState<string[]>([]);
  const [fileList, setFileList] = useState<DirectoryNode[]>([]);
  const [hasConfig, setHasConfig] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expandedPersonas, setExpandedPersonas] = useState<Record<string, boolean>>({});


  const {
    loading,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    getDirectoryStructure,
    getFileList,
    deleteWorkspaceConfig,
    getWorkspaceList,
    createWorkspace
  } = useWorkspace();

  useEffect(() => {
    if (vaultId) {
      // 获取所有工作区列表
      getAllWorkspaces(vaultId);
    } else {
      console.warn('vaultId为空，无法加载工作区');
    }
  }, [vaultId]);

// 修改后的 getAllWorkspaces 函数，递归获取所有目录项
const getAllWorkspaces = async (vaultId: string) => {
  try {
    // 获取工作区列表（只包含包含data.md的目录）
    const workspaceNodes = await getWorkspaceList(vaultId);
    
    // 转换为 WorkspaceItem 格式
    const workspaceItems: WorkspaceItem[] = workspaceNodes.map(node => ({
      id: node.key,
      name: node.title,
      path: node.value
    }));
    
    setWorkspaces(workspaceItems);
  } catch (error) {
    console.error('工作区列表加载失败:', error);
  }
};

  const toggleWorkspace = async (workspaceId: string, path: string) => {
    if (expandedWorkspace === workspaceId) {
      // 收起工作区配置
      setExpandedWorkspace(null);
      setCurrentWorkspacePath('');
    } else {
      // 展开工作区配置
      setExpandedWorkspace(workspaceId);
      setCurrentWorkspacePath(path);
      
      try {
        const config = await loadWorkspaceConfig(path);
        const files = await getFileList(path).catch(() => [] as DirectoryNode[]);
        
        if (config) {
          form.setFieldsValue(config);
          setPersonas(config.personas || []);
          setExcludedPaths(config.excludedPaths || []);
          setHasConfig(true);
          
          if (config.personas) {
            const initialExpanded = config.personas.reduce((acc, persona) => {
              acc[persona.id] = false;
              return acc;
            }, {} as Record<string, boolean>);
            setExpandedPersonas(initialExpanded);
          }
        } else {
          form.setFieldsValue(DEFAULT_WORKSPACE_CONFIG);
          setPersonas(DEFAULT_WORKSPACE_CONFIG.personas || []);
          setExcludedPaths([]);
          setHasConfig(false);
          
          if (DEFAULT_WORKSPACE_CONFIG.personas.length > 0) {
            const initialExpanded = DEFAULT_WORKSPACE_CONFIG.personas.reduce((acc, persona) => {
              acc[persona.id] = false;
              return acc;
            }, {} as Record<string, boolean>);
            setExpandedPersonas(initialExpanded);
          }
        }
        
        setFileList(files);
      } catch (error) {
        console.error('配置加载失败:', error);
        form.setFieldsValue(DEFAULT_WORKSPACE_CONFIG);
        setPersonas(DEFAULT_WORKSPACE_CONFIG.personas || []);
        setExcludedPaths([]);
        setFileList([]);
        setHasConfig(false);
      }
    }
  };

  const togglePersona = (id: string) => {
    setExpandedPersonas(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const config: WorkspaceConfig = {
        ...values,
        personas,
        excludedPaths: excludedPaths || []
      };
      
      await saveWorkspaceConfig(currentWorkspacePath, config);
      setHasConfig(true);
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  const addPersona = () => {
    const newPersona = {
      id: Date.now().toString(),
      name: '默认人设',
      prompt: '这是一个示例人设'
    };
    
    setPersonas([...personas, newPersona]);
    
    setExpandedPersonas(prev => ({
      ...prev,
      [newPersona.id]: true
    }));
  };

  const removePersona = (id: string) => {
    setPersonas(personas.filter(p => p.id !== id));
  };

  const updatePersona = (id: string, field: string, value: string) => {
    setPersonas(personas.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const handleDelete = async () => {
    try {
      await deleteWorkspaceConfig(currentWorkspacePath);
      setShowDeleteConfirm(false);
      setHasConfig(false);
      form.setFieldsValue(DEFAULT_WORKSPACE_CONFIG);
      setPersonas([]);
      setExcludedPaths([]);
      
      // 重新加载工作区列表
      if (vaultId) {
        getAllWorkspaces(vaultId);
      }
    } catch (error) {
      console.error('删除失败: ' + (error as Error).message);
    }
  };

  const handleCreateWorkspace = async () => {
    try {
        // 重新加载工作区列表
        if (vaultId) {
            // 创建工作区（包含文件夹选择）
            await createWorkspace(vaultId);
            getAllWorkspaces(vaultId);
        }
    } catch (error) {
        console.error('创建工作区失败:', error);
    }
  };

  return (
    <div className="workspace-manage">
        <div className="header-container">
            <NavLink to="/obsidian-app">
                <Button icon={<ArrowLeftOutlined />} type="text">返回</Button>
            </NavLink>
            <Space>
                <Button 
                type="primary" 
                icon={<FolderAddOutlined />}
                onClick={handleCreateWorkspace}
                >
                创建工作区
                </Button>
            </Space>
        </div>

        <Card>
        <Title level={4}>工作区列表</Title>
        <List
            dataSource={workspaces}
            renderItem={item => (
            <>
                <List.Item
                actions={[
                    <Button 
                    icon={<EditOutlined />} 
                    onClick={() => toggleWorkspace(item.id, item.path)}
                    >
                    {expandedWorkspace === item.id ? '收起配置' : '配置工作区'}
                    </Button>
                ]}
                >
                <List.Item.Meta
                    title={item.name}
                    description={<Text code>{item.path}</Text>}
                />
                </List.Item>
                
                {/* 在当前项下方展开配置面板 */}
                {expandedWorkspace === item.id && (
                <div className="workspace-config-panel">
                    <div className="config-actions">
                    <Space>
                        <Tooltip title={!currentWorkspacePath ? "请先选择工作区路径" : ""}>
                        <Button 
                            type="primary" 
                            icon={<SaveOutlined />}
                            onClick={handleSave}
                            loading={loading}
                            disabled={!currentWorkspacePath}
                        >
                            保存配置
                        </Button>
                        </Tooltip>
                        
                        <Tooltip title={!hasConfig ? "当前工作区无配置可删除" : ""}>
                        <Button
                            danger
                            onClick={() => setShowDeleteConfirm(true)}
                            disabled={!hasConfig || loading}
                        >
                            删除配置
                        </Button>
                        </Tooltip>
                        
                        {showDeleteConfirm && (
                        <Space className="delete-confirm-area">
                            <span style={{ color: 'red' }}>确定要删除配置吗？</span>
                            <Button 
                            danger 
                            size="small"
                            onClick={handleDelete}
                            loading={loading}
                            >
                            确认删除
                            </Button>
                            <Button 
                            size="small"
                            onClick={() => setShowDeleteConfirm(false)}
                            disabled={loading}
                            >
                            取消
                            </Button>
                        </Space>
                        )}
                    </Space>
                    </div>
                    
                    <Form form={form} layout="vertical">
                    <Form.Item label="版本号" name="version" style={{ marginBottom: 16 }}>
                        <Input placeholder="例如: 1.0.0" />
                    </Form.Item>

                    <div className="section-title">人设管理</div>
                    
                    <Form.Item style={{ marginBottom: 16 }}>
                        <Button 
                        type="dashed" 
                        icon={<PlusOutlined />}
                        onClick={addPersona}
                        block
                        >
                        添加人设
                        </Button>
                    </Form.Item>
                    
                    {personas.map(persona => (
                        <Card key={persona.id} className="persona-card">
                        <div className="persona-header" onClick={() => togglePersona(persona.id)}>
                            <span className="persona-title">{persona.name}</span>
                            <Button 
                            type="text" 
                            icon={expandedPersonas[persona.id] ? <UpOutlined /> : <DownOutlined />}
                            size="small"
                            />
                        </div>
                        
                        {expandedPersonas[persona.id] && (
                            <>
                            <Form.Item label="人设名称" className="persona-form-item">
                                <Input
                                value={persona.name}
                                onChange={(e) => updatePersona(persona.id, 'name', e.target.value)}
                                />
                            </Form.Item>
                            <Form.Item label="人设描述" className="persona-form-item">
                                <Input.TextArea
                                value={persona.prompt}
                                onChange={(e) => updatePersona(persona.id, 'prompt', e.target.value)}
                                autoSize={{ minRows: 3 }}
                                style={{ resize: 'none' }}
                                />
                            </Form.Item>
                            <div style={{ textAlign: 'right' }}>
                                <Button 
                                danger 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removePersona(persona.id);
                                }}
                                size="small"
                                >
                                删除人设
                                </Button>
                            </div>
                            </>
                        )}
                        </Card>
                    ))}

                    <div className="section-title">搜索设置</div>
                    
                    <Form.Item label="排除RAG搜索的路径" name="excludedPaths" style={{ marginBottom: 16 }}>
                        <TreeSelect
                        treeData={fileList}
                        treeCheckable={true}
                        showCheckedStrategy={TreeSelect.SHOW_PARENT}
                        placeholder="请选择要排除的路径"
                        value={excludedPaths}
                        onChange={(value) => {
                            setExcludedPaths(value);
                            form.setFieldsValue({ excludedPaths: value });
                        }}
                        treeNodeFilterProp="title"
                        style={{ width: '100%' }}
                        />
                    </Form.Item>
                    </Form>
                    <Divider />
                </div>
                )}
            </>
            )}
        />
        </Card>
        
    </div>
    );
}