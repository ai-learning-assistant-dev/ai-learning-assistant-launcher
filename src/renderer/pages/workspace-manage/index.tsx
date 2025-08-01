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
  Typography,
  Dropdown,
  Menu,
  Checkbox,
  Spin
} from 'antd';
import { useParams, NavLink } from 'react-router-dom';
import { ArrowLeftOutlined, PlusOutlined, SaveOutlined, UpOutlined, DownOutlined, EditOutlined, FolderAddOutlined, DownSquareOutlined, CloudDownloadOutlined, FolderOpenOutlined } from '@ant-design/icons';
import './index.scss';
import useWorkspace, { RemotePackageInfo } from '../../containers/use-workspace';
import { DirectoryNode, WorkspaceConfig, Persona } from '../../../main/workspace/type-info';

const { Title, Text, Paragraph } = Typography;

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
  const { vaultId } = useParams<{ vaultId: string }>();
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

  // Import Modal State
  const [isRemoteImportModalVisible, setIsRemoteImportModalVisible] = useState(false);
  const [remoteRepoUrl, setRemoteRepoUrl] = useState('https://gitee.com/JeremcyLu/update_test.git');
  const [isFetchingPackages, setIsFetchingPackages] = useState(false);
  const [availablePackages, setAvailablePackages] = useState<RemotePackageInfo[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [targetWorkspacePath, setTargetWorkspacePath] = useState<string | undefined>();

  const {
    loading,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    getFileList,
    deleteWorkspaceConfig,
    getWorkspaceList,
    createWorkspace,
    localImportWorkspace,
    remoteImportGetList,
    remoteImportClonePackage,
  } = useWorkspace();

  const getAllWorkspaces = async (id: string) => {
    try {
      const workspaceNodes = await getWorkspaceList(id);
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

  useEffect(() => {
    if (vaultId) {
      getAllWorkspaces(vaultId);
    } else {
      console.warn('vaultId为空，无法加载工作区');
    }
  }, [vaultId]);

  const toggleWorkspace = async (workspaceId: string, path: string) => {
    // ... (原有代码不变)
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
  // ... (其他原有函数 handleSave, addPersona 等保持不变)
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
      
      if (vaultId) {
        getAllWorkspaces(vaultId);
      }
    } catch (error) {
      console.error('删除失败: ' + (error as Error).message);
    }
  };

  const handleCreateWorkspace = async () => {
    if (vaultId) {
      try {
        await createWorkspace(vaultId);
        getAllWorkspaces(vaultId);
      } catch (error) {
        console.error('创建工作区失败:', error);
      }
    }
  };

  // --- Import Handlers ---
  const handleLocalImport = async () => {
    if (vaultId) {
        try {
            await localImportWorkspace(vaultId);
            getAllWorkspaces(vaultId); // Refresh list after import
        } catch(error) {
            console.error('本地导入失败:', error);
            // message is handled by the hook
        }
    }
  };

  const handleFetchPackages = async () => {
    if (!remoteRepoUrl) {
      message.warning('请输入远程仓库地址');
      return;
    }
    setIsFetchingPackages(true);
    setAvailablePackages([]);
    setSelectedPackages([]);
    try {
      const packages = await remoteImportGetList(remoteRepoUrl);
      if(packages && packages.length > 0) {
        setAvailablePackages(packages);
      } else {
        message.info('未从仓库中找到可用的学习包');
      }
    } catch (error) {
      console.error('获取学习包列表失败:', error);
    } finally {
      setIsFetchingPackages(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedPackages.length === 0) {
      message.warning('请至少选择一个学习包进行下载');
      return;
    }
     if (!targetWorkspacePath) {
        message.warning('请选择要导入的目标工作区');
        return;
    }
    if (!vaultId) return;

    setIsDownloading(true);
    try {
      for (const branch of selectedPackages) {
        const pkg = availablePackages.find(p => p.branch === branch);
        const repo = pkg?.repo || remoteRepoUrl;
        await remoteImportClonePackage(vaultId, repo, branch, targetWorkspacePath);
      }
      message.success('选中的学习包已全部导入成功！');
      setIsRemoteImportModalVisible(false);
      getAllWorkspaces(vaultId);
    } catch (error) {
      console.error('下载学习包失败:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCheckboxChange = (branch: string, isChecked: boolean) => {
    setSelectedPackages(prev => {
      if (isChecked) {
        // 使用 Set 来确保唯一性，然后转回数组
        return [...new Set([...prev, branch])];
      } else {
        // 过滤掉未选中的项
        return prev.filter(p => p !== branch);
      }
    });
  };

  const importMenu = (
    <Menu onClick={({ key }) => {
      if (key === 'local') {
        handleLocalImport();
      } else if (key === 'remote') {
        setIsRemoteImportModalVisible(true);
        setAvailablePackages([]);
        setSelectedPackages([]);
      }
    }}>
      <Menu.Item key="local" icon={<FolderOpenOutlined />}>
        本地导入
      </Menu.Item>
      <Menu.Item key="remote" icon={<CloudDownloadOutlined />}>
        远程导入
      </Menu.Item>
    </Menu>
  );

  return (
    <div className="workspace-manage">
        <div className="header-container">
            <NavLink to="/obsidian-app">
                <Button icon={<ArrowLeftOutlined />} type="text">返回</Button>
            </NavLink>
            <Space>
                <Dropdown overlay={importMenu}>
                    <Button type="default" icon={<DownSquareOutlined />}>
                        导入工作区
                    </Button>
                </Dropdown>
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
            loading={loading && !isFetchingPackages && !isDownloading}
            dataSource={workspaces}
            renderItem={item => (
            <>
                <List.Item
                // ... (原有的 List.Item 代码)
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
                {expandedWorkspace === item.id && (
                 <div className="workspace-config-panel">
                 {/* ... (原有的配置面板JSX) */}
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
        
        <Modal
            title="远程导入学习包"
            visible={isRemoteImportModalVisible}
            onCancel={() => setIsRemoteImportModalVisible(false)}
            footer={[
                <Button key="back" onClick={() => setIsRemoteImportModalVisible(false)}>
                    取消
                </Button>,
                <Button 
                    key="submit" 
                    type="primary" 
                    loading={isDownloading} 
                    onClick={handleDownloadSelected}
                    disabled={selectedPackages.length === 0 || !targetWorkspacePath}
                >
                    下载选中项
                </Button>,
            ]}
            width={800}
        >
            <Space direction="vertical" style={{ width: '100%' }}>
                <Input.Search
                    placeholder="输入远程仓库地址 (e.g., https://gitee.com/user/repo.git)"
                    enterButton="获取学习包"
                    value={remoteRepoUrl}
                    onChange={(e) => setRemoteRepoUrl(e.target.value)}
                    onSearch={handleFetchPackages}
                    loading={isFetchingPackages}
                />
                <Spin spinning={isFetchingPackages}>
                <List
                    // ... (List props are unchanged)
                    header={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>可选的学习包</span>
                            <Space>
                                <Typography.Text>导入到工作区:</Typography.Text>
                                <Select
                                    placeholder="请选择工作区"
                                    style={{ width: 250 }}
                                    value={targetWorkspacePath}
                                    onChange={(value) => setTargetWorkspacePath(value)}
                                    // Disable if no packages are loaded yet
                                    disabled={availablePackages.length === 0}
                                >
                                    {workspaces.map(ws => (
                                        <Select.Option key={ws.path} value={ws.path}>
                                            {ws.name}
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Space>
                        </div>
                    }
                    dataSource={availablePackages}
                    renderItem={(item: RemotePackageInfo) => (
                        <List.Item>
                            <List.Item.Meta
                                avatar={
                                  <Checkbox 
                                    checked={selectedPackages.includes(item.branch)}
                                    onChange={(e) => handleCheckboxChange(item.branch, e.target.checked)}
                                  />
                                }
                                title={item.name}
                                description={
                                    <>
                                        <Paragraph style={{ margin: 0 }}>{item.description}</Paragraph>
                                        <Text type="secondary">分支: {item.branch}</Text> | <Text type="secondary">书籍: {Object.keys(item.books).join(', ')}</Text>
                                    </>
                                }
                            />
                        </List.Item>
                    )}
                    locale={{ emptyText: '请先获取学习包列表' }}
                    style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
                />
            </Spin>
            </Space>
        </Modal>
    </div>
  );
}