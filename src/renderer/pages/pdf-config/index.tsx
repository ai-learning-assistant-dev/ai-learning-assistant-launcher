import { Button, Card, Form, InputNumber, Switch, Typography, Space, message } from 'antd';
import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './index.scss';

const { Title, Text } = Typography;

interface PdfConfig {
  start_page_id: number;
  end_page_id: number;
  table_enable: boolean;
  formula_enable: boolean;
}

const defaultConfig: PdfConfig = {
  start_page_id: 0,
  end_page_id: 99999,
  table_enable: true,
  formula_enable: true,
};

export default function PdfConfig() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<PdfConfig>(defaultConfig);

  // 页面加载时获取配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      window.electron.ipcRenderer.sendMessage('configs', 'get', 'PDF');
    } catch (error) {
      console.error('获取PDF配置失败:', error);
      message.error('获取配置失败');
    }
  };

  const saveConfig = async (values: PdfConfig) => {
    try {
      setLoading(true);
      window.electron.ipcRenderer.sendMessage('configs', 'set', 'PDF', values);
    } catch (error) {
      console.error('保存PDF配置失败:', error);
      message.error('保存配置失败');
    } finally {
      setLoading(false);
    }
  };

  // 监听配置响应
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      'configs',
      (messageType: any, data: any) => {
        if (messageType === 'data') {
          if (data.action === 'get' && data.service === 'PDF') {
            const receivedConfig = data.data || defaultConfig;
            setConfig(receivedConfig);
            form.setFieldsValue(receivedConfig);
          } else if (data.action === 'set' && data.service === 'PDF') {
            message.success('配置保存成功');
            setConfig(data.data);
          }
        } else if (messageType === 'error') {
          message.error(data);
        }
      }
    );

    return () => {
      if (cancel) cancel();
    };
  }, [form]);

  const onFinish = (values: PdfConfig) => {
    // 验证页码范围
    if (values.start_page_id < 0) {
      message.error('起始页码不能小于0');
      return;
    }
    if (values.end_page_id < values.start_page_id) {
      message.error('结束页码不能小于起始页码');
      return;
    }
    if (values.end_page_id > 99999) {
      message.error('结束页码不能大于99999');
      return;
    }

    saveConfig(values);
  };

  const resetToDefault = () => {
    form.setFieldsValue(defaultConfig);
    message.info('已重置为默认配置');
  };

  return (
    <div className="pdf-config">
      <Card>
        <div className="header">
          <NavLink to="/ai-service">
            <Button>返回</Button>
          </NavLink>
          <Title level={3}>PDF转换配置</Title>
        </div>

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card title="页面范围设置" size="small">
            <Form
              form={form}
              layout="vertical"
              onFinish={onFinish}
              initialValues={config}
            >
              <Space size="large" align="start">
                <Form.Item
                  label="起始页码"
                  name="start_page_id"
                  rules={[
                    { required: true, message: '请输入起始页码' },
                    { type: 'number', min: 0, message: '页码不能小于0' }
                  ]}
                  extra="从第几页开始转换，0表示第1页"
                >
                  <InputNumber
                    min={0}
                    max={99999}
                    style={{ width: 120 }}
                    placeholder="0"
                  />
                </Form.Item>

                <Form.Item
                  label="结束页码"
                  name="end_page_id"
                  rules={[
                    { required: true, message: '请输入结束页码' },
                    { type: 'number', min: 0, max: 99999, message: '页码范围0-99999' }
                  ]}
                  extra="转换到第几页结束，99999表示转换到最后一页"
                >
                  <InputNumber
                    min={0}
                    max={99999}
                    style={{ width: 120 }}
                    placeholder="99999"
                  />
                </Form.Item>
              </Space>
            </Form>
          </Card>

          <Card title="解析功能设置" size="small">
            <Form form={form} layout="vertical">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Form.Item
                  label="表格解析"
                  name="table_enable"
                  valuePropName="checked"
                  extra="开启后会识别和转换PDF中的表格内容"
                >
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>

                <Form.Item
                  label="公式解析"
                  name="formula_enable"
                  valuePropName="checked"
                  extra="开启后会识别和转换PDF中的数学公式"
                >
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
              </Space>
            </Form>
          </Card>

          <Card size="small">
            <Space>
              <Button type="primary" loading={loading} onClick={() => form.submit()}>
                保存配置
              </Button>
              <Button onClick={resetToDefault}>
                重置为默认
              </Button>
            </Space>
          </Card>
        </Space>
      </Card>
    </div>
  );
}
