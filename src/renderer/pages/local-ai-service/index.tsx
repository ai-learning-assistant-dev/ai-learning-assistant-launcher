import { Button, message } from 'antd';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import './index.scss';

export default function AiService() {
  const [state, setState] = useState('');

  useEffect(() => {
    (async () => {
      const st = await window.mainHandle.getRTSServiceStatusHandle();
      console.log('status', st);
      setState(st);
    })();
  }, []);

  const install = async () => {
    const res = await window.mainHandle.installRTSServiceHandle();
    console.log("install service result:", res)
    message.info('install: ' + res);
  };
  const run = async () => {
    const res = await window.mainHandle.runRTSServiceHandle();
    console.log("run the service result: ",res)
    message.info('run: ' + res);
  };
  const stop = async () => {
    const res = await window.mainHandle.stopRTSServiceHandle();
    message.info('stop the service result: ' + res);
    // 刷新状态
    const st = await window.mainHandle.getRTSServiceStatusHandle();
    setState(st);
  };

  return (
    <div className="ai-service">
      <div className="header-container">
        <Link to="/hello"><Button>返回</Button></Link>
      </div>
      <p>RTS 当前状态：{state}</p>
      <Button onClick={install}>安装</Button>
      <Button onClick={run}>启动</Button>
      <Button onClick={stop}>停止</Button>
    </div>
  );
}