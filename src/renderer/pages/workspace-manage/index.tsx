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
  Space
} from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import { FolderOpenOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import './index.scss';
import useWorkspace from '../../containers/use-workspace';
import { NavLink } from 'react-router-dom';


export interface WorkspaceConfig {
  version?: string;
  personas?: Persona[];
  excludedPaths?: string[];
}

interface Persona {
  id: string;
  name: string;
  description: string;
}

export default function WorkspaceManage() {
  const { vaultId } = useParams();
  const [form] = Form.useForm();
  const [workspacePath, setWorkspacePath] = useState('');
  const [directoryTree, setDirectoryTree] = useState([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  
  console.log('WorkspaceManage组件初始化，vaultId:', vaultId); // 添加日志

  const {
    loading,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    selectWorkspacePath,
    getDirectoryStructure // 添加这个方法
  } = useWorkspace();

  console.log('useWorkspace hook加载状态:', loading); // 添加日志
  useEffect(() => {
    console.log('useEffect触发，vaultId变化:', vaultId); // 添加日志
    if (vaultId) {
        console.log('开始加载目录结构和配置...'); // 添加日志
       // 加载目录结构
      getDirectoryStructure(vaultId).then(tree => {
        console.log('目录结构加载完成:', tree); // 添加日志
        setDirectoryTree(tree);
      }).catch(error => {
        console.error('目录结构加载失败:', error); // 添加日志
      });
      
      // 尝试加载现有配置
      loadWorkspaceConfig(vaultId).then(config => {
        console.log('工作区配置加载完成:', config); // 添加日志
        if (config) {
          form.setFieldsValue(config);
          setPersonas(config.personas || []);
          setWorkspacePath(vaultId); // 设置工作区路径
        }
      }).catch(error => {
        console.error('工作区配置加载失败:', error); // 添加日志
      });
    } else {
      console.warn('vaultId为空，无法加载工作区'); // 添加日志
    }
  }, [vaultId]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const config: WorkspaceConfig = {
        ...values,
        personas
      };
      
      // 修改为只传入 path 和 config
      await saveWorkspaceConfig(workspacePath, config);
      message.success('工作区配置保存成功');
    } catch (error) {
      message.error('保存失败: ' + (error as Error).message);
    }
  };

  // 修改工作区路径选择处理
  const handlePathSelect = (value: string) => {
    setWorkspacePath(value);
    // 修改为只传入 path
    getDirectoryStructure(value).then(tree => {
      setDirectoryTree(tree);
    });
  };

  const addPersona = () => {
    setPersonas([...personas, {
      id: Date.now().toString(),
      name: '新人设',
      description: ''
    }]);
  };

  const removePersona = (id: string) => {
    setPersonas(personas.filter(p => p.id !== id));
  };

  const updatePersona = (id: string, field: string, value: string) => {
    setPersonas(personas.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  return (
    <div className="workspace-manage">
      <div className="header-container">
        <NavLink to="/obsidian-app">
          <Button>返回</Button>
        </NavLink>
      </div>

      <Card>
        <Form form={form} layout="vertical">
          {/* 基础设置 - 左对齐标题 */}
          <div className="section-title">基础设置</div>
          
          {/* 修改后的工作区路径选择 */}
          <Form.Item label="工作区路径">
            <TreeSelect
                treeData={directoryTree}
                showSearch
                treeDefaultExpandAll
                placeholder="请选择工作区目录"
                style={{ width: '100%' }}
                value={workspacePath || undefined}
                onChange={handlePathSelect}
                // dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
                filterTreeNode={(input, option) =>
                (option.title as string).toLowerCase().includes(input.toLowerCase())
                }
            />
            </Form.Item>

          <Form.Item label="版本号" name="version">
            <Input placeholder="例如: 1.0.0" />
          </Form.Item>

          {/* 人设管理 - 左对齐标题 */}
          <div className="section-title">人设管理</div>
          
          <Form.Item>
            <Button 
              type="dashed" 
              icon={<PlusOutlined />}
              onClick={addPersona}
            >
              添加人设
            </Button>
          </Form.Item>
          
          {personas.map(persona => (
            <Card key={persona.id} size="small" style={{ marginBottom: 16 }}>
              <Form.Item label="人设名称">
                <Input
                  value={persona.name}
                  onChange={(e) => updatePersona(persona.id, 'name', e.target.value)}
                />
              </Form.Item>
              <Form.Item label="人设描述">
                <Input.TextArea
                  value={persona.description}
                  onChange={(e) => updatePersona(persona.id, 'description', e.target.value)}
                />
              </Form.Item>
              <Button danger onClick={() => removePersona(persona.id)}>
                删除
              </Button>
            </Card>
          ))}

          {/* 搜索设置 - 左对齐标题 */}
          <div className="section-title">搜索设置</div>
          
          <Form.Item label="排除RAG搜索的路径" name="excludedPaths">
            <TreeSelect
              treeData={directoryTree}
              treeCheckable
              showCheckedStrategy={TreeSelect.SHOW_PARENT}
              placeholder="请选择要排除的路径"
              style={{ width: '100%' }}
            />
          </Form.Item>
            {/* 将保存按钮移到表单内部底部 */}
          <Form.Item style={{ marginTop: 24, textAlign: 'right' }}>
            <Button 
              type="primary" 
              icon={<SaveOutlined />}
              onClick={handleSave}
            >
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}