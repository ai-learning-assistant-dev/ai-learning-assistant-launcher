import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadLogsAsText } from '../../web-utils';
import { NativeServiceInfo } from '../../../main/native-script/type-info';

export function useNativeTrainingServiceShortcut() {
  const navigate = useNavigate();
  const [initing, setIniting] = useState(true);
  const [serviceInfo, setServiceInfo] = useState<NativeServiceInfo>({
    state: 'not_install',
  });
  const [versionInfo, setVersionInfo] = useState<{
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
      await window.mainHandle.queryNativeTrainingServiceHandle();
    setServiceInfo(serviceInfo);
    const versionInfo =
      await window.mainHandle.courseHaveNewVersionNativeTrainingServiceHandle();
    setVersionInfo(versionInfo);
  }, [setServiceInfo]);

  useEffect(() => {
    updateCourse().then(() => setIniting(false));
    return () => {};
  }, []);

  const start = async () => {
    if (serviceInfo.state === 'not_install') {
      serviceInfo.state = 'installing';
      await window.mainHandle.installNativeTrainingServiceHandle();
      await queryServiceInfo();
      serviceInfo.state = 'starting';
      await window.mainHandle.startNativeTrainingServiceHandle();
      await queryServiceInfo();
    } else if (serviceInfo.state === 'stopped') {
      serviceInfo.state = 'starting';
      await window.mainHandle.startNativeTrainingServiceHandle();
      await queryServiceInfo();
    } else if (serviceInfo.state === 'exited') {
      serviceInfo.state = 'starting';
      await window.mainHandle.startNativeTrainingServiceHandle();
      await queryServiceInfo();
    }
  };

  const remove = async () => {
    if (serviceInfo.state !== 'not_install') {
      serviceInfo.state = 'uninstalling';
      await window.mainHandle.removeNativeTrainingServiceHandle();
      await queryServiceInfo();
    }
  };

  const updateCourse = async () => {
    if (serviceInfo.state !== 'not_install') {
      serviceInfo.state = 'updating';
      await window.mainHandle.updateCourseNativeTrainingServiceHandle();
      await queryServiceInfo();
    }
  };

  const downloadLogs = async () => {
    const serviceName = 'TRAINING';
    const { logs, imageId } =
      await window.mainHandle.logsNativeTrainingServiceHandle();
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
    versionInfo,
    updateCourse,
    downloadLogs,
  };
}
