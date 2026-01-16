export type ActionName = 'select-folder' | 'get-disk-info';
export type ServiceName = 'joint-build';

export const selectFolderHandle = 'joint-build:select-folder';
export const getDiskInfoHandle = 'joint-build:get-disk-info';

export interface DiskInfo {
  total: number; // bytes
  free: number; // bytes
  used: number; // bytes
}
