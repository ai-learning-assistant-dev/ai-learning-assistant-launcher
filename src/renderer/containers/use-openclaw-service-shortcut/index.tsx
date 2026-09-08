import { useCallback, useEffect, useState } from 'react';
import { OpenclawServiceInfo } from '../../../main/openclaw-service/type-info';

export function useOpenclawServiceShortcut() {
  const [initing, setIniting] = useState(true);
  const [serviceInfo, setServiceInfo] = useState<OpenclawServiceInfo>({
    state: 'not_install',
  });

  const queryServiceInfo = useCallback(async () => {
    const info = await window.mainHandle.queryOpenclawServiceHandle();
    setServiceInfo(info);
  }, []);

  useEffect(() => {
    queryServiceInfo().then(() => setIniting(false));
  }, []);

  const install = async () => {
    if (serviceInfo.state !== 'installed') {
      setServiceInfo((prev) => ({ ...prev, state: 'installing' }));
      await window.mainHandle.installOpenclawServiceHandle();
      await queryServiceInfo();
    }
  };

  const remove = async () => {
    if (serviceInfo.state === 'installed') {
      setServiceInfo((prev) => ({ ...prev, state: 'uninstalling' }));
      await window.mainHandle.removeOpenclawServiceHandle();
      await queryServiceInfo();
    }
  };

  const run = async () => {
    await window.mainHandle.runOpenclawServiceHandle();
    await queryServiceInfo();
  };

  const stop = async () => {
    await window.mainHandle.stopOpenclawServiceHandle();
    await queryServiceInfo();
  };

  const openWindow = async () => {
    await window.mainHandle.openOpenclawWindowHandle();
    await queryServiceInfo();
  };

  const copyPageLink = async () => {
    await window.mainHandle.copyOpenclawDashboardUrlHandle();
  };

  return {
    initing,
    state: serviceInfo.state,
    version: serviceInfo.version,
    running: serviceInfo.running ?? false,
    install,
    remove,
    run,
    stop,
    openWindow,
    copyPageLink,
    refresh: queryServiceInfo,
  };
}
