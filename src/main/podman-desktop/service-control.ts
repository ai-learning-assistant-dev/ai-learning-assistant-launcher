import { IpcMain, IpcMainEvent } from 'electron';
import { ServiceName } from './type-info';
import { MESSAGE_TYPE } from '../ipc-data-type';

export interface ServiceControlRequest {
  action: 'toggle' | 'status';
  serviceName: ServiceName;
}

export interface ServiceControlResponse {
  serviceName: ServiceName;
  isEnabled: boolean;
  isOperating: boolean;
  message?: string;
}

// TODO: 这里是与容器服务交互的核心接口
// 当前为mock实现，实际实现时需要调用docker/podman API
class ServiceController {
  private serviceStates: Map<ServiceName, boolean> = new Map();

  constructor() {
    // 初始化服务状态 - 暂时注释掉LLM，因为没有后端支持
    // this.serviceStates.set('LLM', false);
    this.serviceStates.set('ASR', false);
    this.serviceStates.set('TTS', false);
  }

  async toggleService(serviceName: ServiceName): Promise<ServiceControlResponse> {
    try {
      // TODO: 实际实现时，这里应该调用容器管理API
      // 例如：await containerManager.toggleContainer(serviceName);
      
      // Mock实现：模拟异步操作
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const currentState = this.serviceStates.get(serviceName) || false;
      const newState = !currentState;
      this.serviceStates.set(serviceName, newState);

      return {
        serviceName,
        isEnabled: newState,
        isOperating: false,
        message: `服务${newState ? '启动' : '停止'}成功`,
      };
    } catch (error) {
      throw new Error(`服务操作失败: ${error}`);
    }
  }

  async getServiceStatus(serviceName: ServiceName): Promise<ServiceControlResponse> {
    try {
      // TODO: 实际实现时，这里应该查询真实的容器状态
      // 例如：const status = await containerManager.getContainerStatus(serviceName);
      
      const isEnabled = this.serviceStates.get(serviceName) || false;
      
      return {
        serviceName,
        isEnabled,
        isOperating: false,
      };
    } catch (error) {
      throw new Error(`获取服务状态失败: ${error}`);
    }
  }

  async getAllServicesStatus(): Promise<ServiceControlResponse[]> {
    // 暂时注释掉LLM，因为没有后端支持
    const services: ServiceName[] = [/* 'LLM', */ 'ASR', 'TTS'];
    const results: ServiceControlResponse[] = [];
    
    for (const service of services) {
      try {
        const status = await this.getServiceStatus(service);
        results.push(status);
      } catch (error) {
        results.push({
          serviceName: service,
          isEnabled: false,
          isOperating: false,
          message: `获取状态失败: ${error}`,
        });
      }
    }
    
    return results;
  }
}

const serviceController = new ServiceController();

export default function initServiceControl(ipcMain: IpcMain) {
  ipcMain.handle('service-control', async (event: IpcMainEvent, request: ServiceControlRequest) => {
    try {
      let response: ServiceControlResponse | ServiceControlResponse[];
      
      switch (request.action) {
        case 'toggle':
          response = await serviceController.toggleService(request.serviceName);
          break;
        case 'status':
          if (request.serviceName) {
            response = await serviceController.getServiceStatus(request.serviceName);
          } else {
            response = await serviceController.getAllServicesStatus();
          }
          break;
        default:
          throw new Error(`未知的操作: ${request.action}`);
      }
      
      return {
        success: true,
        data: response,
      };
    } catch (error) {
      console.error('Service control error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

// 导出服务控制器实例，供其他模块使用
export { serviceController }; 