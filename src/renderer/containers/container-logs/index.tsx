import { useEffect, useRef, useState } from 'react';
import {
  containerLogsChannel,
  ServiceName,
} from '../../../main/podman-desktop/type-info';
import {
  AllAction,
  MESSAGE_TYPE,
  MessageData,
} from '../../../main/ipc-data-type';
import { Button, Card, Tag, message } from 'antd';
import './index.scss';
import { downloadLogsAsText, LogEntry } from '../../web-utils';

export default function ContainerLogs(props: { serviceName: ServiceName }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [visibleLogs, setVisibleLogs] = useState<LogEntry[]>([]);
  const [imageId, setImageId] = useState<string>('');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const logDomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      containerLogsChannel,
      (
        messageType: MESSAGE_TYPE,
        data: MessageData<
          AllAction,
          ServiceName,
          { logs: string; imageId: string }
        >,
      ) => {
        if (
          messageType === MESSAGE_TYPE.DATA &&
          data.action === 'logs' &&
          data.service === props.serviceName
        ) {
          // console.debug('reciveLogs', data.data);
          const newLogs = data.data.logs
            .split('\n')
            .filter((log) => log != '')
            .map<LogEntry>((log, index) => {
              const time = new Date(log.split(' ')[0]).toLocaleString();
              const content = log.split(' ').slice(1).join(' ');
              return {
                id: index.toString(),
                timestamp: time,
                level: 'info',
                message: time === 'Invalid Date' ? log : content,
              };
            });
          setLogs(newLogs);
          setVisibleLogs(newLogs.slice(newLogs.length - 1000, newLogs.length));
          setImageId(data.data.imageId);
          if (!loaded) {
            setLoaded(true);
          }
          if (logs.length != newLogs.length) {
            if (logDomRef.current) {
              setTimeout(() => {
                logDomRef.current.scrollTop = logDomRef.current.scrollHeight;
              }, 100);
            }
          }
        }
      },
    );
    return cancel;
  }, [logs, setLogs, setVisibleLogs, logDomRef]);
  useEffect(() => {
    const interval = setInterval(() => {
      window.electron.ipcRenderer.sendMessage(
        containerLogsChannel,
        'logs',
        props.serviceName,
      );
    }, 2000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const downloadHandle = () => {
    if (logs.length === 0) {
      message.warning('没有日志可下载');
      return;
    }
    const logText = logs
      .map(
        (log) =>
          `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`,
      )
      .join('\n');
    // 添加文件头信息
    const header =
      `服务名称: ${props.serviceName}\n` +
      `日志总数: ${logs.length}条\n` +
      `导出时间: ${new Date().toLocaleString()}\n` +
      `镜像ID: ${imageId || '未知'}\n` +
      '='.repeat(50) +
      '\n\n';

    const fullText = header + logText;
    const fileName = `${props.serviceName}_logs_${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.log`;
    downloadLogsAsText(fullText, fileName);
    message.success(`日志下载成功，共${logs.length}条记录`);
  };

  return (
    <Card
      className="logs-card"
      title={
        loaded
          ? `服务日志 (显示${visibleLogs.length}条，总共${logs.length}条)， 版本ID ${imageId}`
          : `服务日志 加载中...`
      }
      extra={
        <Button
          onClick={downloadHandle}
          loading={downloading}
          disabled={logs.length === 0}
        >
          下载完整日志
        </Button>
      }
      size="small"
    >
      <div
        className="logs-container"
        ref={(dom) => {
          logDomRef.current = dom;
        }}
      >
        {visibleLogs.length === 0 ? (
          <div className="no-logs">暂无日志</div>
        ) : (
          visibleLogs.map((log, index) => (
            <div key={index} className={`log-entry log-${log.level}`}>
              <span className="log-timestamp">{log.timestamp}</span>
              <Tag
                color={
                  log.level === 'error'
                    ? 'red'
                    : log.level === 'warning'
                      ? 'orange'
                      : log.level === 'success'
                        ? 'green'
                        : 'blue'
                }
              >
                {log.level}
              </Tag>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
