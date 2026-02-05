import {
  NativeServiceItem,
  NativeServiceName,
  NativeServiceInfo,
} from './type-info';

export async function getServiceInfo(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  return { state: 'not_install', version: '1.0.0' };
}
export async function getServiceLogs(serviceName: NativeServiceName) {}
export async function installService(serviceName: NativeServiceName) {}
export async function monitorStatusIsHealthy(
  serviceName: NativeServiceName,
): Promise<boolean> {
  return true;
}
export async function uninstallService(serviceName: NativeServiceName) {}
export async function startService(
  serviceName: NativeServiceName,
): Promise<NativeServiceInfo> {
  return { state: 'running', version: '1.0.0' };
}
export async function stopService(serviceName: NativeServiceName) {}
export async function updateService(serviceName: NativeServiceName) {}
