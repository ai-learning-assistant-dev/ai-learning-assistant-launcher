import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadLogsAsText } from '../../web-utils';
import { NativeServiceInfo } from '../../../main/native-script/type-info';

export function useTextbookEditorServiceShortcut() {
  const navigate = useNavigate();
  const [initing, setIniting] = useState(true);
  const [serviceInfo, setServiceInfo] = useState<NativeServiceInfo>({
    state: 'not_install',
  });

  const [programVersionInfo, setProgramVersionInfo] = useState<{
    currentVersion: string;
    latestVersion: string;
    haveNew: boolean;
  }>({
    currentVersion: '0.0.0',
    latestVersion: '0.0.0',
    haveNew: false,
  });

  const queryServiceInfo = useCallback(async () => {
    const serviceInfo =
      await window.mainHandle.queryTextbookEditorServiceHandle();
    setServiceInfo(serviceInfo);
    const pVersionInfo =
      await window.mainHandle.haveNewVersionTextbookEditorServiceHandle();
    setProgramVersionInfo(pVersionInfo)
  }, [setServiceInfo]);

  useEffect(() => {
    queryServiceInfo().then(() => setIniting(false));
    return () => {};
  }, []);

  const start = async () => {
    if (serviceInfo.state === 'not_install') {
      serviceInfo.state = 'installing';
      await window.mainHandle.installTextbookEditorServiceHandle();
      await queryServiceInfo();
      serviceInfo.state = 'starting';
      await window.mainHandle.startTextbookEditorServiceHandle();
      await queryServiceInfo();
    } else {
      serviceInfo.state = 'starting';
      await window.mainHandle.startTextbookEditorServiceHandle();
      await queryServiceInfo();
    }
  };

  const remove = async () => {
    if (serviceInfo.state !== 'not_install') {
      serviceInfo.state = 'uninstalling';
      await window.mainHandle.removeTextbookEditorServiceHandle();
      await queryServiceInfo();
    }
  };

  const update = async () => {
    await queryServiceInfo();
    if (serviceInfo.state !== 'not_install') {
      serviceInfo.state = 'updating';
      await window.mainHandle.updateTextbookEditorServiceHandle();
    }
    await queryServiceInfo();
  };

  const downloadLogs = async () => {
    const serviceName = 'TEXTBOOK_EDITOR';
    const { logs, imageId } =
      await window.mainHandle.logsTextbookEditorServiceHandle();
    // 添加文件头信息
    const header =
      `服务名称: ${serviceName}\n` +
      `导出时间: ${new Date().toLocaleString()}\n` +
      `镜像ID: ${imageId || '未知'}\n` +
      '='.repeat(50) +
      '\n\n';

    const fullText = header + logs;
    const fileName = `${serviceName}_logs_${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.log`;
    downloadLogsAsText(fullText, fileName);
  };

  return {
    initing,
    state: serviceInfo.state,
    start,
    remove,
    programVersionInfo,
    update,
    downloadLogs,
  };
}
