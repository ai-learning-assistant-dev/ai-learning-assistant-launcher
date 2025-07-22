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
  Tooltip
} from 'antd';
import { useParams, NavLink } from 'react-router-dom';
import { ArrowLeftOutlined, PlusOutlined, SaveOutlined, UpOutlined, DownOutlined  } from '@ant-design/icons';
import './index.scss';
import useWorkspace from '../../containers/use-workspace';
import { DirectoryNode, WorkspaceConfig, Persona } from '../../../main/workspace/type-info';


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


export default function WorkspaceManage() {
  const { vaultId } = useParams();
  const [form] = Form.useForm();
  const [workspacePath, setWorkspacePath] = useState('');
  const [directoryTree, setDirectoryTree] = useState([]);
  const [personas, setPersonas] = useState<Persona[]>([]);

  // 在 WorkspaceManage 组件中添加状态
  const [excludedPaths, setExcludedPaths] = useState<string[]>([]);
  const [fileList, setFileList] = useState<DirectoryNode[]>([]);

  const [hasConfig, setHasConfig] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  //组件中添加折叠状态管理
  const [expandedPersonas, setExpandedPersonas] = useState<Record<string, boolean>>({});

  const {
    loading,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    getDirectoryStructure,
    getFileList,
    deleteWorkspaceConfig
  } = useWorkspace();

  useEffect(() => {
    if (vaultId) {
      // 仅加载目录结构
      getDirectoryStructure(vaultId)
        .then(tree => {

          setDirectoryTree(tree);
        })
        .catch(error => {
          console.error('目录结构加载失败:', error);
        });
      
    } else {
      console.warn('vaultId为空，无法加载工作区'); // 添加日志
    }
  }, [vaultId]);

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
        excludedPaths: excludedPaths || [] // 确保包含排除路径
      };
      
      await saveWorkspaceConfig(workspacePath, config);
      setHasConfig(true); // 保存成功后设置为有配置
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  // 修改路径选择处理逻辑
  const handlePathSelect = async (value: string) => {
    try {
      setWorkspacePath(value);
      const config = await loadWorkspaceConfig(value);
      const files = await getFileList(value).catch(() => [] as DirectoryNode[]);

      // 明确区分null(无配置)和有配置的情况
      if (config) {
        form.setFieldsValue(config);
        setPersonas(config.personas || []);
        setExcludedPaths(config.excludedPaths || []);
        setHasConfig(true); // 有配置

        // 仅在初次加载时展开所有人设
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
        setHasConfig(false); // 无配置

        // 默认人设也展开
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
      // 使用默认配置
      form.setFieldsValue(DEFAULT_WORKSPACE_CONFIG);
      setPersonas(DEFAULT_WORKSPACE_CONFIG.personas || []);
      setExcludedPaths([]); // 重置排除路径
      setFileList([]);
      setHasConfig(false);
    }
  };

  const addPersona = () => {
    const newPersona = {
      id: Date.now().toString(),
      name: '默认人设',
      prompt: '这是一个示例人设'
    };
    
    setPersonas([...personas, newPersona]);
    
    // 仅展开新增的人设，不影响其他人设的折叠状态
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

  // 添加删除处理函数
  const handleDelete = async () => {
    try {
      await deleteWorkspaceConfig(workspacePath);
      setShowDeleteConfirm(false)
      setHasConfig(false);
      form.setFieldsValue(DEFAULT_WORKSPACE_CONFIG);
      setPersonas([]);
      setExcludedPaths([]);
    } catch (error) {
      console.error('删除失败: ' + (error as Error).message);
    }
  };

  return (
    <div className="workspace-manage">
      <div className="header-container">
        <NavLink to="/obsidian-app">
          <Button icon={<ArrowLeftOutlined />} type="text">返回</Button>
        </NavLink>
        <Space>
          <Tooltip title={hasConfig ? "" : "当前工作区无配置可删除"}>
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
                onClick={ handleDelete }
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
          
          <Tooltip title={!workspacePath ? "请先选择工作区路径" : ""}>
            <Button 
              type="primary" 
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={loading}
              disabled={!workspacePath}
            >
              保存配置
            </Button>
          </Tooltip>
        </Space>
      </div>

      <Card>
        {/* 基础设置 - 带分割线的标题 */}
        <div className="section-title">基础设置</div>
        
        <Form form={form} layout="vertical">
          <Form.Item label="工作区路径" style={{ marginBottom: 16 }}>
            <TreeSelect
              treeData={directoryTree}
              showSearch
              treeDefaultExpandAll
              placeholder="请选择工作区目录"
              value={workspacePath || undefined}
              onChange={handlePathSelect}
              filterTreeNode={(input, option) =>
                (option.title as string).toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item label="版本号" name="version" style={{ marginBottom: 16 }}>
            <Input placeholder="例如: 1.0.0" />
          </Form.Item>

          {/* 人设管理 - 带分割线的标题 */}
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

          {/* 搜索设置 - 带分割线的标题 */}
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
      </Card>
    </div>
  );
}

