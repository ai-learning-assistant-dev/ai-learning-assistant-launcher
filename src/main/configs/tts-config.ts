import { ActionName, ServiceName } from './type-info';

export async function ttsConfig(
  event: Electron.IpcMainEvent,
  action: ActionName,
  serviceName: ServiceName,
  extraData?: any,
) {
  const env = extraData?.env;
  return true;
}
