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
import { Card, Tag } from 'antd';
import './index.scss';

export interface LogEntry {
  id: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export default function ContainerLogs(props: { serviceName: ServiceName }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loaded, setLoaded] = useState<boolean>(false);
  const logDomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      containerLogsChannel,
      (
        messageType: MESSAGE_TYPE,
        data: MessageData<AllAction, ServiceName, string>,
      ) => {
        if (
          messageType === MESSAGE_TYPE.DATA &&
          data.action === 'logs' &&
          data.service === props.serviceName
        ) {
          // console.debug('reciveLogs', data.data);
          const newLogs = data.data.split('\n').map<LogEntry>((log, index) => {
            return {
              id: index.toString(),
              timestamp: '',
              level: 'info',
              message: log,
            };
          });
          setLogs(newLogs);
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
  }, [logs, setLogs, logDomRef]);
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
  return (
    <Card
      className="logs-card"
      title={loaded ? `服务日志 (${logs.length}条)` : `服务日志 加载中...`}
      size="small"
    >
      <div
        className="logs-container"
        ref={(dom) => {
          logDomRef.current = dom;
        }}
      >
        {logs.length === 0 ? (
          <div className="no-logs">暂无日志</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={`log-entry log-${log.level}`}>
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
