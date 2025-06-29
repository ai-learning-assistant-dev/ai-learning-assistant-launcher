import { useState, useCallback, useEffect } from 'react';
import { ServiceName } from '../../../main/podman-desktop/type-info';

export interface ServiceControlState {
  [key: string]: {
    isEnabled: boolean;
    isOperating: boolean;
  };
}

interface ServiceControlRequest {
  action: 'toggle' | 'status';
  serviceName: ServiceName;
}

interface ServiceControlResponse {
  serviceName: ServiceName;
  isEnabled: boolean;
  isOperating: boolean;
  message?: string;
}

export default function useServiceControl() {
  const [serviceStates, setServiceStates] = useState<ServiceControlState>({
    LLM: { isEnabled: false, isOperating: false },
    ASR: { isEnabled: false, isOperating: false },
    TTS: { isEnabled: false, isOperating: false },
  });

  // 从后端获取服务状态
  const refreshServiceStates = useCallback(async () => {
    try {
      // TODO: 调用后端IPC接口获取所有服务状态
      // 目前使用mock数据
      const mockResponse: ServiceControlResponse[] = [
        { serviceName: 'LLM', isEnabled: false, isOperating: false },
        { serviceName: 'ASR', isEnabled: false, isOperating: false },
        { serviceName: 'TTS', isEnabled: false, isOperating: false },
      ];

      const newStates: ServiceControlState = {};
      mockResponse.forEach(service => {
        newStates[service.serviceName] = {
          isEnabled: service.isEnabled,
          isOperating: service.isOperating,
        };
      });
      
      setServiceStates(newStates);
    } catch (error) {
      console.error('Failed to refresh service states:', error);
    }
  }, []);

  const toggleService = useCallback(async (serviceName: ServiceName): Promise<boolean> => {
    // 设置操作状态
    setServiceStates(prev => ({
      ...prev,
      [serviceName]: {
        ...prev[serviceName],
        isOperating: true,
      },
    }));

    try {
      // TODO: 调用后端IPC接口切换服务状态
      // const result = await window.electron.ipcRenderer.invoke('service-control', {
      //   action: 'toggle',
      //   serviceName,
      // } as ServiceControlRequest);
      
      // if (!result.success) {
      //   throw new Error(result.error);
      // }
      
      // const response = result.data as ServiceControlResponse;
      
      // Mock实现：模拟后端响应
      const currentState = serviceStates[serviceName]?.isEnabled || false;
      const newState = !currentState;
      
      // 模拟异步操作
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const response: ServiceControlResponse = {
        serviceName,
        isEnabled: newState,
        isOperating: false,
        message: `服务${newState ? '启动' : '停止'}成功`,
      };
      
      // 更新服务状态
      setServiceStates(prev => ({
        ...prev,
        [serviceName]: {
          isEnabled: response.isEnabled,
          isOperating: false,
        },
      }));

      return response.isEnabled;
    } catch (error) {
      // 操作失败，恢复操作状态
      setServiceStates(prev => ({
        ...prev,
        [serviceName]: {
          ...prev[serviceName],
          isOperating: false,
        },
      }));
      throw error;
    }
  }, [serviceStates]);

  const getServiceState = useCallback((serviceName: ServiceName) => {
    return serviceStates[serviceName] || { isEnabled: false, isOperating: false };
  }, [serviceStates]);

  // 检查单个服务状态
  const checkServiceStatus = useCallback(async (serviceName: ServiceName): Promise<boolean> => {
    try {
      // TODO: 调用后端IPC接口检查服务状态
      // const result = await window.electron.ipcRenderer.invoke('service-control', {
      //   action: 'status',
      //   serviceName,
      // } as ServiceControlRequest);
      
      // if (!result.success) {
      //   throw new Error(result.error);
      // }
      
      // const response = result.data as ServiceControlResponse;
      // return response.isEnabled;
      
      // Mock实现
      return serviceStates[serviceName]?.isEnabled || false;
    } catch (error) {
      console.error(`Failed to check service status for ${serviceName}:`, error);
      return false;
    }
  }, [serviceStates]);

  // 初始化时获取服务状态
  useEffect(() => {
    refreshServiceStates();
  }, [refreshServiceStates]);

  return {
    serviceStates,
    toggleService,
    getServiceState,
    checkServiceStatus,
    refreshServiceStates,
  };
} 