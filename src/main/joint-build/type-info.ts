export type ActionName = 'select-folder' | 'get-disk-info' | 'set-tray-enabled';
export type ServiceName = 'joint-build';

export const selectFolderHandle = 'joint-build:select-folder';
export const getDiskInfoHandle = 'joint-build:get-disk-info';
export const setTrayEnabledHandle = 'joint-build:set-tray-enabled';

export interface DiskInfo {
  total: number; // bytes
  free: number; // bytes
  used: number; // bytes
}
