import { NativeServiceName } from './type-info';

export async function getServiceInfo(serviceName: NativeServiceName) {
  return { Status: 'healthy', version: '1.0,0' };
}
export async function getServiceLogs(serviceName: NativeServiceName) {}
export async function installService(serviceName: NativeServiceName) {}
export async function monitorStatusIsHealthy(serviceName: NativeServiceName) {}
export async function uninstallService(serviceName: NativeServiceName) {}
export async function startService(serviceName: NativeServiceName) {
  return { Status: 'healthy', version: '1.0,0' };
}
export async function stopService(serviceName: NativeServiceName) {}
export async function updateService(serviceName: NativeServiceName) {}
