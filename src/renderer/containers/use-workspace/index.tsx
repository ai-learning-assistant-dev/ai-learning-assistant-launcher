import { useState, useCallback, useEffect } from 'react';
import { message } from 'antd';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';
import { ActionName, channel, ServiceName, DirectoryNode, WorkspaceConfig } from '../../../main/workspace/type-info';

interface UseWorkspaceReturn {
  loading: boolean;
  loadWorkspaceConfig: (path: string) => Promise<WorkspaceConfig | null>;
  saveWorkspaceConfig: (path: string, config: WorkspaceConfig) => Promise<void>;
  getDirectoryStructure: (vaultId: string) => Promise<DirectoryNode[]>;
  getFileList: (path: string) => Promise<DirectoryNode[]>;
  deleteWorkspaceConfig: (path: string) => Promise<void>;
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
        console.log('[IPC Response]', messageType, data); // 添加详细日志
        
        if (messageType === MESSAGE_TYPE.ERROR) {
          if (pendingPromise) {
            pendingPromise.reject(data);
            setPendingPromise(null);
          }
          setLoading(false);
        } 
        else if (messageType === MESSAGE_TYPE.INFO) {
          // 处理成功信息
          if (pendingPromise) {
            pendingPromise.resolve(true); // 返回成功状态
            setPendingPromise(null);
          }
          setLoading(false);
        }
        else if (messageType === MESSAGE_TYPE.DATA) {
          const response = data as MessageData<ActionName, ServiceName, any>;
          console.log('[IPC Data]', response.action, response.data); // 添加详细日志
          
          if (pendingPromise) {
            pendingPromise.resolve(response.data);
            setPendingPromise(null);
          }
          setLoading(false);
        }
      }
    );
    return () => unsubscribe();
  }, [pendingPromise]); // 添加依赖项

  const sendIpcMessage = useCallback(<T,>(action: ActionName, ...args: unknown[]): Promise<T> => {
    if (loading) {
      return Promise.reject('请等待上一个操作完成后再操作');
    }

    setLoading(true);
    return new Promise((resolve, reject) => {
      setPendingPromise({ resolve, reject });
      console.log('[IPC Request]', action, args); // 添加发送日志
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
      console.error('加载配置失败: ' + error);
      return null;
    }
  }, [sendIpcMessage]);

  const saveWorkspaceConfig = useCallback(async (path: string, config: WorkspaceConfig) => {
    try {
      await sendIpcMessage<void>('save-config', path, { config });
      message.success('工作区配置文件保存成功');
    } catch (error) {
      console.error('保存配置失败: ' + error);
      message.error('保存失败: ' + (error as Error).message);
    }
  }, [sendIpcMessage]);

  const getDirectoryStructure = useCallback(async (vaultId: string): Promise<DirectoryNode[]> => {
    try {
      const result = await sendIpcMessage<DirectoryNode[]>('get-directory-structure', vaultId);
      return result;
    } catch (error) {
      console.error('获取目录结构失败: ' + error);
      return [];
    }
  }, [sendIpcMessage]);

  const getFileList = useCallback(async (path: string): Promise<DirectoryNode[]> => {
    try {
      const result = await sendIpcMessage<DirectoryNode[]>('get-file-list', path);
      return result;
    } catch (error) {
      console.error('获取文件列表失败: ' + error);
      return [];
    }
  }, [sendIpcMessage]);

  const deleteWorkspaceConfig = useCallback(async (path: string) => {
    try {
      await sendIpcMessage<void>('delete-config', path);
      message.success('配置删除成功');
    } catch (error) {
      console.error('配置删除失败: ' + error);
    }
  }, [sendIpcMessage]);

  return {
    loading,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    getDirectoryStructure,
    getFileList,
    deleteWorkspaceConfig
  };
}

export default useWorkspace;