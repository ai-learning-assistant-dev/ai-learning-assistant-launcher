import { useState, useCallback, useEffect } from 'react';
import { message } from 'antd';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';
import { ActionName, channel, ServiceName, DirectoryNode, WorkspaceConfig } from '../../../main/workspace/type-info';

// 假设这些类型会添加到 type-info.ts
export interface RemotePackageInfo {
  name: string;
  books: Record<string, string>;
  description: string;
  branch: string;
  repo?: string;
  hasDataMd?: boolean; // 新增：标识是否包含data.md文件
}

interface UseWorkspaceReturn {
  loading: boolean;
  loadWorkspaceConfig: (path: string) => Promise<WorkspaceConfig | null>;
  saveWorkspaceConfig: (path: string, config: WorkspaceConfig) => Promise<void>;
  getDirectoryStructure: (vaultId: string) => Promise<DirectoryNode[]>;
  getFileList: (path: string) => Promise<DirectoryNode[]>;
  deleteWorkspaceConfig: (path: string) => Promise<void>;
  getWorkspaceList: (vaultId: string) => Promise<DirectoryNode[]>;
  createWorkspace: (vaultId: string) => Promise<void>;
  localImportWorkspace: (vaultId: string) => Promise<void>;
  remoteImportGetList: (repoUrl: string) => Promise<RemotePackageInfo[]>;
  remoteImportClonePackage: (vaultId: string, repoUrl: string, branch: string, targetWorkspacePath: string, hasDataMd?: boolean) => Promise<void>;
  updateWorkspace: (targetWorkspacePath: string) => Promise<void>;
}

export function useWorkspace(): UseWorkspaceReturn {
  const [loading, setLoading] = useState(false);
  const [pendingPromise, setPendingPromise] = useState<{
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  } | null>(null);

  useEffect(() => {
    const unsubscribe = window.electron?.ipcRenderer.on(
      channel,
      (messageType, data) => {
        console.log('[IPC Response]', messageType, data);
        
        if (pendingPromise) {
            if (messageType === MESSAGE_TYPE.ERROR) {
                pendingPromise.reject(data);
            } else if (messageType === MESSAGE_TYPE.INFO) {
                message.success(data.toString());
                pendingPromise.resolve(true);
            } else if (messageType === MESSAGE_TYPE.DATA) {
                const response = data as MessageData<ActionName, ServiceName, any>;
                pendingPromise.resolve(response.data);
            } else {
                // For other message types, we might not want to resolve/reject
                return;
            }
            setPendingPromise(null);
            setLoading(false);
        } else {
            // Handle unsolicited messages if necessary
            if (messageType === MESSAGE_TYPE.ERROR) {
                message.error(data.toString());
            } else if (messageType === MESSAGE_TYPE.INFO) {
                message.success(data.toString());
            }
        }
      }
    );
    return () => unsubscribe();
  }, [pendingPromise]);

  const sendIpcMessage = useCallback(<T,>(action: ActionName, vaultIdOrData: any, ...args: unknown[]): Promise<T> => {
    // 调整了参数处理，以适应新旧函数的不同签名
    if (loading && action !== 'remote-import-get-list' && action !== 'remote-import-clone-package') {
      //message.warn('请等待上一个操作完成后再操作');
      return Promise.reject('请等待上一个操作完成后再操作');
    }
    
    // 特定操作可以并发
    const currentLoading = (action === 'remote-import-get-list' || action === 'remote-import-clone-package') ? false : loading;
    if (currentLoading) {
      //...
    }

    setLoading(true);
    return new Promise((resolve, reject) => {
      setPendingPromise({ resolve, reject });
      console.log('[IPC Request]', action, vaultIdOrData, ...args);
      // 根据action决定参数结构
      if (['save-config', 'load-config', 'get-file-list', 'delete-config'].includes(action)) {
         window.electron.ipcRenderer.sendMessage(channel, action, 'workspace', vaultIdOrData, ...args);
      } else if (['remote-import-get-list'].includes(action)) {
         window.electron.ipcRenderer.sendMessage(channel, action, 'workspace', null, vaultIdOrData); // vaultId is null
      }
      else {
         window.electron.ipcRenderer.sendMessage(channel, action, 'workspace', vaultIdOrData, ...args);
      }
    });
  }, [loading]);
  
  // --- 原有函数 ---
  const loadWorkspaceConfig = useCallback(async (path: string): Promise<WorkspaceConfig | null> => {
    return sendIpcMessage<WorkspaceConfig | null>('load-config', path);
  }, [sendIpcMessage]);

  const saveWorkspaceConfig = useCallback(async (path: string, config: WorkspaceConfig) => {
    return sendIpcMessage<void>('save-config', path, { config });
  }, [sendIpcMessage]);

  const getDirectoryStructure = useCallback(async (vaultId: string): Promise<DirectoryNode[]> => {
    return sendIpcMessage<DirectoryNode[]>('get-directory-structure', vaultId).catch(() => []);
  }, [sendIpcMessage]);

  const getFileList = useCallback(async (path: string): Promise<DirectoryNode[]> => {
    return sendIpcMessage<DirectoryNode[]>('get-file-list', path).catch(() => []);
  }, [sendIpcMessage]);

  const deleteWorkspaceConfig = useCallback(async (path: string) => {
    return sendIpcMessage<void>('delete-config', path);
  }, [sendIpcMessage]);

  const getWorkspaceList = useCallback(async (vaultId: string): Promise<DirectoryNode[]> => {
    return sendIpcMessage<DirectoryNode[]>('get-workspace-list', vaultId).catch(() => []);
  }, [sendIpcMessage]);

  const createWorkspace = useCallback(async (vaultId: string) => {
    return sendIpcMessage<void>('create-workspace', vaultId);
  }, [sendIpcMessage]);

  // --- 新增函数 ---
  const localImportWorkspace = useCallback(async (vaultId: string) => {
    return sendIpcMessage<void>('local-import-workspace', vaultId);
  }, [sendIpcMessage]);

  const remoteImportGetList = useCallback(async (repoUrl: string): Promise<RemotePackageInfo[]> => {
    return sendIpcMessage<RemotePackageInfo[]>('remote-import-get-list', { repoUrl }).catch(() => []);
  }, [sendIpcMessage]);

  const remoteImportClonePackage = useCallback(async (vaultId: string, repoUrl: string, branch: string, targetWorkspacePath: string, hasDataMd?: boolean) => {
    return sendIpcMessage<void>('remote-import-clone-package', vaultId, { repoUrl, branch, targetWorkspacePath, hasDataMd });
  }, [sendIpcMessage]);

  const updateWorkspace = useCallback(async (targetWorkspacePath: string) => {
    // 此 action 不依赖 vaultId，由主进程直接使用目标路径
    return sendIpcMessage<void>('update-workspace', null, { targetWorkspacePath });
  }, [sendIpcMessage]);

  return {
    loading,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    getDirectoryStructure,
    getFileList,
    deleteWorkspaceConfig,
    getWorkspaceList,
    createWorkspace,
    localImportWorkspace,
    remoteImportGetList,
    remoteImportClonePackage,
    updateWorkspace,
  };
}

export default useWorkspace;