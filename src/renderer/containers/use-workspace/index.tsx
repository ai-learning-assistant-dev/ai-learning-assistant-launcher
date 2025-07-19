import { useState, useCallback, useEffect } from 'react';
import { message } from 'antd';
import { WorkspaceConfig } from '../../pages/workspace-manage';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';
import { ActionName, channel, ServiceName } from '../../../main/workspace/type-info';

interface DirectoryNode {
  title: string;
  value: string;
  key: string;
  children?: DirectoryNode[];
  isLeaf?: boolean;
}

interface UseWorkspaceReturn {
  loading: boolean;
  loadWorkspaceConfig: (path: string) => Promise<WorkspaceConfig | null>;
  saveWorkspaceConfig: (path: string, config: WorkspaceConfig) => Promise<void>;
  selectWorkspacePath: () => Promise<string>;
  getDirectoryStructure: (path: string) => Promise<DirectoryNode[]>;
}
export function useWorkspace(): UseWorkspaceReturn {
  const [loading, setLoading] = useState(false);
  const [pendingPromise, setPendingPromise] = useState<{
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  } | null>(null);

  const handleIpcResponse = useCallback((messageType: MESSAGE_TYPE, data: MessageData<ActionName, ServiceName, any>) => {
    if (!pendingPromise) return;

    if (messageType === MESSAGE_TYPE.ERROR) {
      pendingPromise.reject(data.data as unknown as string); // 修改这里
    } else if (messageType === MESSAGE_TYPE.DATA) {
      pendingPromise.resolve(data.data);
    }

    setPendingPromise(null);
    setLoading(false);
  }, [pendingPromise]);

  useEffect(() => {
    const unsubscribe = window.electron?.ipcRenderer.on(channel, handleIpcResponse);
    return () => unsubscribe();
  }, [handleIpcResponse]);

  const sendIpcMessage = useCallback(<T,>(action: ActionName, ...args: unknown[]): Promise<T> => {
    if (loading) {
      return Promise.reject('请等待上一个操作完成后再操作');
    }

    setLoading(true);
    return new Promise((resolve, reject) => {
      setPendingPromise({ resolve, reject });
      window.electron.ipcRenderer.sendMessage(
        channel,
        action,
        'workspace',
        ...args
      );
    });
  }, [loading]);

  const loadWorkspaceConfig = useCallback(async (path: string): Promise<WorkspaceConfig | null> => {
    try {
      return await sendIpcMessage<WorkspaceConfig>('load-config', path);
    } catch (error) {
      message.error('加载配置失败: ' + error);
      return null;
    }
  }, [sendIpcMessage]);

  const saveWorkspaceConfig = useCallback(async (path: string, config: WorkspaceConfig) => {
    try {
      await sendIpcMessage<void>('save-config', { path, config });
    } catch (error) {
      throw error;
    }
  }, [sendIpcMessage]);

  const selectWorkspacePath = useCallback(async (): Promise<string> => {
    try {
      return await sendIpcMessage<string>('select-path');
    } catch (error) {
      message.error('选择路径失败: ' + error);
      return '';
    }
  }, [sendIpcMessage]);

  const getDirectoryStructure = useCallback(async (path: string): Promise<DirectoryNode[]> => {
    try {
      return await sendIpcMessage<DirectoryNode[]>('get-directory-structure', path);
    } catch (error) {
      message.error('获取目录结构失败: ' + error);
      return [];
    }
  }, [sendIpcMessage]);

  return {
    loading,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    selectWorkspacePath,
    getDirectoryStructure // 添加这个方法
  };
}

export default useWorkspace;