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
    // 暂时注释掉LLM，因为没有后端支持
    // LLM: { isEnabled: false, isOperating: false },
    ASR: { isEnabled: false, isOperating: false },
    TTS: { isEnabled: false, isOperating: false },
  });

  // 从后端获取服务状态
  const refreshServiceStates = useCallback(async () => {
    try {
      // 调用后端IPC接口获取所有服务状态
      const result = await window.electron.ipcRenderer.invoke('service-control', {
        action: 'status',
        serviceName: undefined, // 获取所有服务状态
      } as ServiceControlRequest);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      const services = result.data as ServiceControlResponse[];
      const newStates: ServiceControlState = {};
      services.forEach(service => {
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
      // 调用后端IPC接口切换服务状态
      const result = await window.electron.ipcRenderer.invoke('service-control', {
        action: 'toggle',
        serviceName,
      } as ServiceControlRequest);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      const response = result.data as ServiceControlResponse;
      
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
      // 调用后端IPC接口检查服务状态
      const result = await window.electron.ipcRenderer.invoke('service-control', {
        action: 'status',
        serviceName,
      } as ServiceControlRequest);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      const response = result.data as ServiceControlResponse;
      return response.isEnabled;
    } catch (error) {
      console.error(`Failed to check service status for ${serviceName}:`, error);
      return false;
    }
  }, []);

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