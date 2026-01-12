import { Button, List, Modal, Popconfirm, Typography } from 'antd';
import { Link, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './index.scss';

interface ServiceItem {
  name: string;
  serviceName: string;
  state: '还未安装' | '已经停止' | '正在运行';
  port: number;
}

const serviceInfos: ServiceItem[] = [
  {
    name: '学科培训语音',
    serviceName: 'VOICE_RTC',
    state: '已经停止',
    port: 8989,
  },
];

export default function AiService() {
  const [state, setState] = useState('');

  useEffect(() => {
    (async () => {
      const st = await window.mainHandle.getRTSServiceStatusHandle();
      console.log('status', st);
      setState(st);
    })();
  }, []);

  return (
    <div className="ai-service">
      <div>
        <p>当前状态：{state}</p>
      </div>

      <List
        className="ai-service-list"
        header={
          <div className="header-container">
            <Link to="/hello">
              <Button>返回</Button>
            </Link>
          </div>
        }
        bordered
        dataSource={serviceInfos}
        renderItem={(item) => (
          <List.Item
            actions={[
              `访问地址：http://127.0.0.1:${item.port}`,
              <NavLink key="config" to={`/${item.serviceName}-config`}>
                <Button size="small">设置</Button>
              </NavLink>,
              item.serviceName === 'PDF' && item.state === '正在运行' ? (
                <NavLink key="convert" to="/pdf-convert">
                  <Button type="primary" size="small">转换PDF</Button>
                </NavLink>
              ) : (
                item.state !== '还未安装' && (
                  <Button
                    size="small"
                    disabled={false}
                  >
                    更新
                  </Button>
                )
              ),
              item.state === '已经停止' && (
                <Button
                  size="small"
                  type="primary"
                >
                  启动
                </Button>
              ),
              item.state === '已经停止' && (
                <Popconfirm
                  title="删除服务"
                  description="你确定要删除服务？"
                  onConfirm={() => {}}
                  okText="确认删除"
                  cancelText="不删除"
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              ),
              item.state === '还未安装' && (
                <Button
                  size="small"
                  type="primary"
                >
                  安装
                </Button>
              ),
            ].filter(Boolean)}
          >
            <Typography.Text type="success">[{item.state}]</Typography.Text>
            {item.name}
          </List.Item>
        )}
      />
    </div>
  );
}