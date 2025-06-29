import { IpcMain, IpcMainEvent } from 'electron';
import { ServiceName, containerNameDict } from './type-info';
import { MESSAGE_TYPE } from '../ipc-data-type';
import { Exec } from '../exec';
import { getPodmanCli } from './ensure-podman-works';

const commandLine = new Exec();

// 日志发送函数
function sendServiceLog(event: IpcMainEvent, level: 'info' | 'warning' | 'error' | 'success', service: string, message: string) {
  event.reply('service-logs', {
    level,
    service,
    message,
    timestamp: new Date().toISOString(),
  });
}

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

// 真实的容器服务控制器
class ServiceController {
  private eventRef: IpcMainEvent | null = null;

  constructor() {
    // 不再需要内存状态存储，直接查询容器状态
  }

  // 设置事件引用，用于发送日志
  setEventRef(event: IpcMainEvent) {
    this.eventRef = event;
  }

  // 检查容器是否运行
  private async isContainerRunning(containerName: string): Promise<boolean> {
    try {
      const { stdout } = await commandLine.exec(getPodmanCli(), [
        'ps',
        '--filter', `name=${containerName}`,
        '--format', '{{.Names}}'
      ]);
      return stdout.trim().includes(containerName);
    } catch (error) {
      console.error('检查容器状态失败:', error);
      return false;
    }
  }

  // 检查容器内服务是否运行
  private async isServiceRunning(containerName: string, serviceName: ServiceName): Promise<boolean> {
    try {
      // 检查容器是否运行
      const containerRunning = await this.isContainerRunning(containerName);
      if (!containerRunning) {
        return false;
      }

      // 检查服务进程是否存在
      const serviceType = serviceName.toLowerCase();
      const { stdout } = await commandLine.exec(getPodmanCli(), [
        'exec',
        containerName,
        'pgrep',
        '-f',
        serviceType === 'asr' ? 'asr' : 'tts'
      ]);
      
      return stdout.trim().length > 0;
    } catch (error) {
      // pgrep 没找到进程会返回非0退出码，这是正常的
      return false;
    }
  }

  async toggleService(serviceName: ServiceName): Promise<ServiceControlResponse> {
    try {
      const containerName = containerNameDict[serviceName];
      if (!containerName) {
        throw new Error(`未找到服务 ${serviceName} 对应的容器`);
      }

      this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `开始切换服务状态`);

      // 检查容器是否运行
      const containerRunning = await this.isContainerRunning(containerName);
      if (!containerRunning) {
        throw new Error(`容器 ${containerName} 未运行，请先安装并启动容器`);
      }

      // 检查当前服务状态
      const currentState = await this.isServiceRunning(containerName, serviceName);
      const serviceType = serviceName.toLowerCase();
      
      if (currentState) {
        // 停止服务
        this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `正在停止 ${serviceName} 服务`);
        await commandLine.exec(getPodmanCli(), [
          'exec',
          '-e', `SERVICE_TYPE=${serviceType}`,
          containerName,
          './stop.sh'
        ]);
        this.eventRef && sendServiceLog(this.eventRef, 'success', serviceName, `${serviceName} 服务停止成功`);
      } else {
        // 启动服务
        this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `正在启动 ${serviceName} 服务`);
        await commandLine.exec(getPodmanCli(), [
          'exec',
          '-e', `SERVICE_TYPE=${serviceType}`,
          containerName,
          './start.sh'
        ]);
        this.eventRef && sendServiceLog(this.eventRef, 'success', serviceName, `${serviceName} 服务启动成功`);
      }

      const newState = !currentState;
      return {
        serviceName,
        isEnabled: newState,
        isOperating: false,
        message: `服务${newState ? '启动' : '停止'}成功`,
      };
    } catch (error) {
      const errorMsg = `服务操作失败: ${error}`;
      this.eventRef && sendServiceLog(this.eventRef, 'error', serviceName, errorMsg);
      throw new Error(errorMsg);
    }
  }

  async getServiceStatus(serviceName: ServiceName): Promise<ServiceControlResponse> {
    try {
      const containerName = containerNameDict[serviceName];
      if (!containerName) {
        throw new Error(`未找到服务 ${serviceName} 对应的容器`);
      }

      // 检查容器是否运行
      const containerRunning = await this.isContainerRunning(containerName);
      if (!containerRunning) {
        return {
          serviceName,
          isEnabled: false,
          isOperating: false,
          message: '容器未运行',
        };
      }

      // 检查服务状态
      const isEnabled = await this.isServiceRunning(containerName, serviceName);
      
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
      // 设置事件引用，用于发送日志
      serviceController.setEventRef(event);
      
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