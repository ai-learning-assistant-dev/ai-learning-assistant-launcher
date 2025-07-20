import type { Channels } from '../ipc-data-type';

export type ServiceName = 'workspace' | 'all';
export type ActionName = 'save-config' | 'load-config' | 'get-directory-structure' | 'get-file-list' | 'delete-config';

export const channel: Channels = 'workspace';

export interface WorkspaceData {
  path: string;
  config?: {
    version?: string;
    personas?: Array<{
      id: string;
      name: string;
      description: string;
    }>;
    excludedPaths?: string[];
  };
}

export interface DirectoryNode {
  title: string;
  value: string;
  key: string;
  children?: DirectoryNode[];
  isLeaf?: boolean;
}