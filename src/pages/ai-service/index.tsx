import { Button, List, Typography } from 'antd';
import { Link } from 'react-router-dom';
import './index.scss';

export default function AiService() {
  return (
    <div className="ai-service">
      <List
        className="ai-service-list"
        header={
          <Link to="/hello">
            <Button>返回</Button>
          </Link>
        }
        bordered
      >
        <List.Item actions={[<a>更新</a>, <a>停止</a>]}>
          <Typography.Text type="success">[正在运行]</Typography.Text>对话机器人
        </List.Item>
        <List.Item actions={[<a>更新</a>, <a>启动</a>]}>
          <Typography.Text type="warning">[已经停止]</Typography.Text>文字转语音
        </List.Item>
        <List.Item actions={[<a>安装</a>]}>
          <Typography.Text type="danger">[还未安装]</Typography.Text>语音转文字
        </List.Item>
      </List>
    </div>
  );
}
