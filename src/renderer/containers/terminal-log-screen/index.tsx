import { useEffect, useRef } from 'react';
import { ITerminalInitOnlyOptions, Terminal } from '@xterm/xterm';
import { Tomorrow } from 'xterm-theme';
import '@xterm/xterm/css/xterm.css';
import { channel } from '../../../main/terminal-log/type-info';
import {
  AllService,
  MESSAGE_TYPE,
  MessageData,
} from '../../../main/ipc-data-type';

/** 命令行日志，让用户可以查看当前耗时任务的运行进度 */
export function TerminalLogScreen(
  props: {
    id: string;
    style?: React.CSSProperties;
    className?: string;
  } & ITerminalInitOnlyOptions,
) {
  const termRef = useRef<Terminal>(null);
  useEffect(() => {
    const term = new Terminal({
      disableStdin: true,
      cols: props.cols,
      rows: props.rows,
      theme: Tomorrow,
      fontSize: 12,
      convertEol: true,
    });
    termRef.current = term;
    term.open(document.getElementById(props.id));
    const cancel = window.electron?.ipcRenderer.on(
      channel,
      (
        messageType: MESSAGE_TYPE.DATA,
        messageData: MessageData<'query', AllService, string>,
      ) => {
        // console.log(messageData);
        termRef.current && termRef.current.write(messageData.data);
      },
    );
    return () => {
      cancel();
      term.dispose();
    };
  }, [termRef]);
  return (
    <div id={props.id} style={props.style} className={props.className}></div>
  );
}
