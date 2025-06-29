import { IpcMain, IpcMainEvent, IpcMainInvokeEvent, webContents } from 'electron';
import { ServiceName, containerNameDict } from './type-info';
import { MESSAGE_TYPE } from '../ipc-data-type';
import { Exec } from '../exec';
import { getPodmanCli } from './ensure-podman-works';

const commandLine = new Exec();

// 日志发送函数 - 支持不同类型的事件对象
function sendServiceLog(event: IpcMainEvent | IpcMainInvokeEvent, level: 'info' | 'warning' | 'error' | 'success', service: string, message: string) {
  const logData = {
    level,
    service,
    message,
    timestamp: new Date().toISOString(),
  };
  
  // 对于 handle 方法，使用 webContents 发送
  if ('sender' in event && event.sender) {
    event.sender.send('service-logs', logData);
  } else if ('reply' in event && typeof event.reply === 'function') {
    // 对于 on 方法，使用 reply
    event.reply('service-logs', logData);
  }
}

export interface ServiceControlRequest {
  action: 'toggle' | 'status';
  serviceName?: ServiceName;
  modelOptions?: {
    forceGPU?: boolean;
    forceCPU?: boolean;
  };
}

export interface ServiceControlResponse {
  serviceName: ServiceName;
  isEnabled: boolean;
  isOperating: boolean;
  message?: string;
}

// 真实的容器服务控制器
class ServiceController {
  private eventRef: IpcMainEvent | IpcMainInvokeEvent | null = null;
  // 内存中记录服务运行状态
  private serviceStates: Map<ServiceName, boolean> = new Map();

  constructor() {
    // 初始化服务状态为停止
    this.serviceStates.set('ASR', false);
    this.serviceStates.set('TTS', false);
    this.serviceStates.set('VOICE', false);
  }

  // 设置事件引用，用于发送日志
  setEventRef(event: IpcMainEvent | IpcMainInvokeEvent) {
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

  // 获取服务状态（从内存中读取）
  private getServiceState(serviceName: ServiceName): boolean {
    return this.serviceStates.get(serviceName) || false;
  }

  // 设置服务状态（在内存中记录）
  private setServiceState(serviceName: ServiceName, isRunning: boolean): void {
    this.serviceStates.set(serviceName, isRunning);
    this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `服务状态已更新: ${isRunning ? '运行中' : '已停止'}`);
  }

  // 重置所有服务状态（容器重启时使用）
  private resetAllServiceStates(): void {
    this.serviceStates.set('ASR', false);
    this.serviceStates.set('TTS', false);
    this.serviceStates.set('VOICE', false);
  }



  // 检查服务进程是否启动（基于进程的服务状态检测）
  private async isServiceProcessReady(serviceName: ServiceName): Promise<boolean> {
    const containerName = containerNameDict[serviceName];
    if (!containerName) return false;

    try {
      if (serviceName === 'ASR') {
        return await this.checkASRProcess(containerName);
      } else if (serviceName === 'TTS') {
        return await this.checkTTSProcess(containerName);
      } else if (serviceName === 'VOICE') {
        // 对于VOICE服务，检查ASR和TTS进程
        const [asrRunning, ttsRunning] = await Promise.all([
          this.checkASRProcess(containerName),
          this.checkTTSProcess(containerName)
        ]);
        return asrRunning || ttsRunning; // 至少有一个服务在运行
      }
      
      return false;
    } catch (error) {
      this.eventRef && sendServiceLog(this.eventRef, 'error', serviceName, `进程检查失败: ${error}`);
      return false;
    }
  }

  // 检查ASR进程是否在运行
  private async checkASRProcess(containerName: string): Promise<boolean> {
    try {
      // ASR服务：进程包含 python.*launcher.py
      const { stdout } = await commandLine.exec(getPodmanCli(), [
        'exec',
        containerName,
        'ps',
        'aux'
      ]);
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes('python') && line.includes('launcher.py')) {
          this.eventRef && sendServiceLog(this.eventRef, 'info', 'ASR', `找到ASR进程: ${line.trim()}`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.eventRef && sendServiceLog(this.eventRef, 'error', 'ASR', `ASR进程检查失败: ${error}`);
      return false;
    }
  }

  // 检查TTS进程是否在运行
  private async checkTTSProcess(containerName: string): Promise<boolean> {
    try {
      // TTS服务：进程包含 python.*cli.py 且包含 tts 或 run
      const { stdout } = await commandLine.exec(getPodmanCli(), [
        'exec',
        containerName,
        'ps',
        'aux'
      ]);
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes('python') && line.includes('cli.py') && 
            (line.includes('tts') || line.includes('run'))) {
          this.eventRef && sendServiceLog(this.eventRef, 'info', 'TTS', `找到TTS进程: ${line.trim()}`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.eventRef && sendServiceLog(this.eventRef, 'error', 'TTS', `TTS进程检查失败: ${error}`);
      return false;
    }
  }

  // 获取容器日志（最后几行）
  private async getContainerLogs(containerName: string, lines: number = 20): Promise<string> {
    try {
      const { stdout } = await commandLine.exec(getPodmanCli(), [
        'logs',
        '--tail', lines.toString(),
        containerName
      ]);
      return stdout;
    } catch (error) {
      return `获取日志失败: ${error}`;
    }
  }

  async toggleService(serviceName: ServiceName, modelOptions?: { forceGPU?: boolean; forceCPU?: boolean }): Promise<ServiceControlResponse> {
    try {
      const containerName = containerNameDict[serviceName];
      if (!containerName) {
        throw new Error(`未找到服务 ${serviceName} 对应的容器`);
      }

      this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `开始切换服务状态`);

      // 检查容器是否运行
      const containerRunning = await this.isContainerRunning(containerName);
      if (!containerRunning) {
        // 容器未运行，重置所有服务状态
        this.resetAllServiceStates();
        throw new Error(`容器 ${containerName} 未运行，请先安装并启动容器`);
      }

      // 检查当前服务状态（从内存中读取）
      const currentState = this.getServiceState(serviceName);
      const serviceType = serviceName.toLowerCase();
      
      if (currentState) {
        // 停止服务
        this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `正在停止 ${serviceName} 服务`);
        
        try {
          await Promise.race([
            commandLine.exec(getPodmanCli(), [
              'exec',
              // '-w', '/app',
              '-e', `SERVICE_TYPE=${serviceType}`,
              containerName,
              './stop.sh'
            ]),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('停止服务超时')), 30000)
            )
          ]);
          // 停止成功，更新内存状态
          this.setServiceState(serviceName, false);
          this.eventRef && sendServiceLog(this.eventRef, 'success', serviceName, `${serviceName} 服务停止成功`);
        } catch (error) {
          // 停止失败，状态可能仍在运行，保持原状态不变
          this.eventRef && sendServiceLog(this.eventRef, 'error', serviceName, `停止服务失败: ${error}`);
          throw error;
        }
      } else {
        // 启动服务
        this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `正在启动 ${serviceName} 服务`);
        
        try {
          // 准备环境变量
          const envVars = [`SERVICE_TYPE=${serviceType}`];
          
          // 为ASR服务添加SenseVoice模型配置
        //   if (serviceType === 'asr') {
        //     envVars.push('SENSEVOICE_MODEL=iic/SenseVoiceSmall');
        //   }
          
          // 为TTS服务添加模型选择配置
          if (serviceType === 'tts' && modelOptions) {
            if (modelOptions.forceGPU) {
              envVars.push('TTS_MODELS=index-tts');
              this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, '已配置强制使用N卡加速模型 (index-tts)');
            } else if (modelOptions.forceCPU) {
              envVars.push('TTS_MODELS=kokoro');
              this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, '已配置强制使用CPU优化模型 (kokoro)');
            }
          }
          
          const envArgs = envVars.flatMap(env => ['-e', env]);
          // const fullCommand = `podman exec -w /app ${envArgs.join(' ')} ${containerName} ./start.sh`;
          const fullCommand = `podman exec ${envArgs.join(' ')} ${containerName} ./start.sh`;

          this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `执行启动命令: ${fullCommand}`);
          
          // 启动服务（异步执行，不等待脚本完成）
          this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, '启动服务脚本...');
          
          // 使用 -d (detach) 模式异步执行启动脚本
          commandLine.exec(getPodmanCli(), [
            'exec',
            '-d', // 分离模式，不等待命令完成
            ...envArgs,
            containerName,
            './start.sh'
          ]).catch(error => {
            this.eventRef && sendServiceLog(this.eventRef, 'warning', serviceName, `启动脚本执行警告: ${error}`);
          });
          
          this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, '启动脚本已执行，等待服务进程启动...');
          
          // 等待服务进程启动，最多等待30秒
          let processReady = false;
          let waitTime = 0;
          const maxWaitTime = 30000; // 30秒
          const checkInterval = 2000; // 每2秒检查一次
          
          while (waitTime < maxWaitTime && !processReady) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waitTime += checkInterval;
            
            this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `检查服务进程状态... (${waitTime/1000}s)`);
            processReady = await this.isServiceProcessReady(serviceName);
            
            if (processReady) {
              break;
            }
          }
          
          if (processReady) {
            // 进程检测成功，更新内存状态
            this.setServiceState(serviceName, true);
            this.eventRef && sendServiceLog(this.eventRef, 'success', serviceName, `${serviceName} 服务启动成功，进程已就绪 (${waitTime/1000}s)`);
          } else {
            // 进程检测失败，可能服务启动失败
            this.setServiceState(serviceName, false);
            throw new Error(`服务启动失败：等待${maxWaitTime/1000}秒后仍未检测到服务进程`);
          }
        } catch (error) {
          // 启动失败，确保状态为停止
          this.setServiceState(serviceName, false);
          
          let errorMsg = `启动服务失败: ${error}`;
          if (error instanceof Error) {
            if (error.message.includes('超时')) {
              errorMsg = `启动服务超时，可能是服务启动时间过长或遇到问题`;
              
              // 获取容器日志帮助诊断
              this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, '获取容器日志进行诊断...');
              try {
                const logs = await this.getContainerLogs(containerName, 30);
                this.eventRef && sendServiceLog(this.eventRef, 'info', serviceName, `容器最近30行日志:\n${logs}`);
              } catch (logError) {
                this.eventRef && sendServiceLog(this.eventRef, 'warning', serviceName, `无法获取容器日志: ${logError}`);
              }
            } else {
              errorMsg = `启动服务失败: ${error.message}`;
            }
          }
          this.eventRef && sendServiceLog(this.eventRef, 'error', serviceName, errorMsg);
          throw new Error(errorMsg);
        }
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
        // 容器未运行，重置所有服务状态
        this.resetAllServiceStates();
        return {
          serviceName,
          isEnabled: false,
          isOperating: false,
          message: '容器未运行',
        };
      }

      // 检查服务状态（从内存中读取）
      const isEnabled = this.getServiceState(serviceName);
      
      // 如果内存状态显示服务运行中，进一步检查进程状态
      let actualStatus = isEnabled;
      let message = undefined;
      
      if (isEnabled) {
        const isProcessReady = await this.isServiceProcessReady(serviceName);
        if (!isProcessReady) {
          message = '服务已启动但进程未就绪';
        }
      }
      
      return {
        serviceName,
        isEnabled: actualStatus,
        isOperating: false,
        message,
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
  ipcMain.handle('service-control', async (event: IpcMainInvokeEvent, request: ServiceControlRequest) => {
    try {
      // 设置事件引用，用于发送日志
      serviceController.setEventRef(event);
      
      let response: ServiceControlResponse | ServiceControlResponse[];
      
      switch (request.action) {
        case 'toggle':
          if (!request.serviceName) {
            throw new Error('toggle操作需要指定serviceName');
          }
          response = await serviceController.toggleService(request.serviceName, request.modelOptions);
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