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
  serviceName?: ServiceName;
  modelOptions?: {
    forceGPU?: boolean;
    forceCPU?: boolean;
  };
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

  const toggleService = useCallback(async (serviceName: ServiceName, modelOptions?: { forceGPU?: boolean; forceCPU?: boolean }): Promise<boolean> => {
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
        modelOptions,
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
    
    // 监听容器停止事件
    const handleContainerStopped = (data: any) => {
      console.log('收到容器停止通知:', data);
      const { serviceName, containerName } = data;
      
      // 如果是语音服务容器（ASR_TTS），需要重置ASR和TTS的状态
      if (containerName === 'ASR_TTS') {
        setServiceStates(prev => ({
          ...prev,
          ASR: { isEnabled: false, isOperating: false },
          TTS: { isEnabled: false, isOperating: false },
        }));
        console.log('已重置ASR和TTS服务状态');
      } else {
        // 重置对应服务的状态
        setServiceStates(prev => ({
          ...prev,
          [serviceName]: { isEnabled: false, isOperating: false },
        }));
        console.log(`已重置${serviceName}服务状态`);
      }
    };

    const cancel = window.electron?.ipcRenderer.on('container-stopped', handleContainerStopped);
    
    return () => {
      cancel && cancel();
    };
  }, [refreshServiceStates]);

  return {
    serviceStates,
    toggleService,
    getServiceState,
    checkServiceStatus,
    refreshServiceStates,
  };
} 