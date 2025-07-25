import { useState } from 'react';
import { Button, Form, Input, Card, Typography, message } from 'antd';
import { NavLink } from 'react-router-dom';
import './index.scss';
import useConfigs from '../../containers/use-configs';

const { Title } = Typography;
const { TextArea } = Input;

export default function AddWorkspace() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { action: configsAction } = useConfigs();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      // 生成新的ID（简单的时间戳方式）
      const newId = Date.now().toString();
      
      // 构建新的工作区配置
      const newWorkspace = {
        id: newId,
        title: values.title,
        description: values.description,
        link: values.link
      };

      // 调用后端保存配置
      configsAction('addWorkspace', 'showcase', newWorkspace);
      
      message.success('工作区添加成功！');
      
      // 延迟跳转，让用户看到成功消息
      setTimeout(() => {
        window.history.back();
      }, 1000);
      
    } catch (error) {
      message.error('添加工作区失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-workspace">
      <div className="add-workspace-header">
        <NavLink to="/showcase">
          <Button>返回</Button>
        </NavLink>
        <Title level={3}>增加工作区</Title>
      </div>
      
      <Card className="add-workspace-card">
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          autoComplete="off"
        >
          <Form.Item
            label="工作区名称"
            name="title"
            rules={[{ required: true, message: '请输入工作区名称' }]}
          >
            <Input placeholder="请输入工作区名称" />
          </Form.Item>

          <Form.Item
            label="工作区路径"
            name="description"
            rules={[{ required: true, message: '请输入工作区路径' }]}
          >
            <Input placeholder="例如：D:/workspace" />
          </Form.Item>

          <Form.Item
            label="配置链接"
            name="link"
            rules={[{ required: true, message: '请输入配置链接' }]}
          >
            <Input placeholder="例如：https://example.com" />
          </Form.Item>

          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              size="large"
              block
            >
              保存工作区
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
} 