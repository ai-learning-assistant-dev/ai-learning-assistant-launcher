import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';

export type RtsOperation = 'install' | 'run' | 'stop' | null;

// 英文消息到中文的翻译映射（面向普通用户的友好提示）
const messageTranslations: Record<string, string> = {
  // run.ps1 messages - 启动服务相关
  'Checking uv package manager...': '正在检查运行环境...',
  'uv not found, please install first': '运行环境未就绪，请先点击安装',
  'uv found': '运行环境已就绪',
  'Starting service process...': '正在启动语音服务...',
  'Waiting for service to start...': '语音服务正在初始化...',
  'Process exited unexpectedly': '服务启动异常，请重试',
  'RTS service started': '语音服务已启动',
  'Service start timeout': '服务启动超时，请检查网络后重试',
  'Entering service directory...': '正在准备服务环境...',
  'Checking and syncing dependencies...': '正在检查必要组件...',
  'Dependency sync may have issues, continuing...':
    '部分组件可能需要更新，继续启动...',
  'Dependencies check complete': '组件检查完成',
  // install.ps1 messages - 安装服务相关
  'uv installed': '运行环境已就绪',
  'Installing uv package manager...': '正在安装运行环境...',
  'uv installation complete': '运行环境安装完成',
  'uv install may have issues, trying to continue...':
    '环境安装可能不完整，尝试继续...',
  'Code package exists, skipping download': '服务文件已存在，跳过下载',
  'Downloading RTS code package...': '正在下载语音服务组件...',
  'Code package download complete': '语音服务组件下载完成',
  'Code already extracted, skipping': '服务已准备就绪',
  'Updating config files...': '正在配置服务...',
  'Config update complete': '服务配置完成',
  'Extracting code package...': '正在解压服务文件...',
  'Code extraction complete': '服务文件解压完成',
  'Installation complete': '安装完成，可以启动服务了',
  'Dependencies synced, skipping': '必要组件已就绪',
  'Syncing dependencies...': '正在下载必要组件（首次可能需要几分钟）...',
  'Dependencies sync complete': '必要组件准备完成',
};

// 翻译消息函数（支持动态参数）
function translateMessage(msg: string): string {
  // 精确匹配
  if (messageTranslations[msg]) {
    return messageTranslations[msg];
  }
  // 动态消息匹配（如 "Waiting for service ready... (40s)")
  const waitingMatch = msg.match(
    /^Waiting for service ready\.\.\. \((\d+)s\)$/,
  );
  if (waitingMatch) {
    return `语音服务启动中，请稍候... (已等待${waitingMatch[1]}秒)`;
  }
  // 模型加载消息
  if (msg.startsWith('Loading models:')) {
    return '正在加载语音识别模型，首次启动可能需要几分钟...';
  }
  // 错误消息匹配
  if (msg.startsWith('Start failed:')) {
    return '服务启动失败，请检查网络连接后重试';
  }
  if (msg.startsWith('Download failed:')) {
    return '下载失败，请检查网络连接后重试';
  }
  if (msg.startsWith('Installation failed:')) {
    return '安装失败，请检查网络连接或磁盘空间后重试';
  }
  return msg;
}

export interface UseRtsServiceReturn {
  rtsState: string;
  rtsLoading: boolean;
  rtsProgress: number;
  rtsOperation: RtsOperation;
  rtsStageMessage: string;
  rtsErrorMessage: string;
  clearRtsError: () => void;
  refreshRtsStatus: () => Promise<string>;
  installRts: () => Promise<void>;
  runRts: () => Promise<void>;
  stopRts: () => Promise<void>;
}

export function useRtsService(): UseRtsServiceReturn {
  const [rtsState, setRtsState] = useState('');
  const [rtsLoading, setRtsLoading] = useState(false);
  const [rtsProgress, setRtsProgress] = useState(0);
  const [rtsOperation, setRtsOperation] = useState<RtsOperation>(null);
  const [rtsStageMessage, setRtsStageMessage] = useState('');
  const [rtsErrorMessage, setRtsErrorMessage] = useState('');

  const clearRtsError = useCallback(() => {
    setRtsErrorMessage('');
  }, []);

  // 使用 ref 来跟踪当前操作，避免闭包问题
  const operationRef = useRef<RtsOperation>(null);
  // 使用操作ID来追踪每次操作，防止旧操作的finally覆盖新操作的状态
  const operationIdRef = useRef<number>(0);

  // 刷新 RTS 状态
  const refreshRtsStatus = useCallback(async () => {
    try {
      const st = await window.mainHandle.getRTSServiceStatusHandle();
      console.log('RTS status', st);
      setRtsState(st);
      return st;
    } catch (error) {
      console.error('获取 RTS 状态失败:', error);
      return '';
    }
  }, []);

  // RTS 安装
  const installRts = useCallback(async () => {
    // 分配新的操作ID
    const currentOpId = ++operationIdRef.current;
    setRtsLoading(true);
    setRtsOperation('install');
    operationRef.current = 'install';
    setRtsProgress(0);
    setRtsStageMessage('准备开始安装...');

    try {
      const res = await window.mainHandle.installRTSServiceHandle();
      console.log('install RTS service result:', res);

      // 只有当前操作ID匹配时才更新状态
      if (operationIdRef.current !== currentOpId) {
        console.log('install: 操作已被新操作取代，跳过状态更新');
        return;
      }

      setRtsProgress(100);
      setRtsStageMessage('安装完成');

      if (res.includes('success')) {
        message.success('RTS 服务安装成功！');
        await refreshRtsStatus();
      } else {
        message.warning('安装完成，但可能有问题：' + res);
        await refreshRtsStatus();
      }
    } catch (error) {
      if (operationIdRef.current !== currentOpId) return;
      message.error('安装失败：' + error);
      setRtsStageMessage('安装失败');
    } finally {
      // 只有当前操作ID匹配时才重置loading状态
      if (operationIdRef.current === currentOpId) {
        setRtsLoading(false);
        setRtsOperation(null);
        operationRef.current = null;
        setTimeout(() => {
          setRtsProgress(0);
          setRtsStageMessage('');
        }, 1000);
      }
    }
  }, [refreshRtsStatus]);

  // RTS 启动
  const runRts = useCallback(async () => {
    // 分配新的操作ID
    const currentOpId = ++operationIdRef.current;
    setRtsLoading(true);
    setRtsOperation('run');
    operationRef.current = 'run';
    setRtsProgress(0);
    setRtsStageMessage('准备启动服务...');

    try {
      const res = await window.mainHandle.runRTSServiceHandle();
      console.log('run RTS service result: ', res);

      // 只有当前操作ID匹配时才更新状态
      if (operationIdRef.current !== currentOpId) {
        console.log('run: 操作已被新操作取代，跳过状态更新');
        return;
      }

      setRtsProgress(100);
      setRtsStageMessage('服务已启动');

      if (!res.includes('success')) {
        message.error('启动失败：' + res);
        setRtsStageMessage('启动失败');
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      await refreshRtsStatus();
    } catch (error) {
      if (operationIdRef.current !== currentOpId) return;
      message.error('启动失败：' + error);
      setRtsStageMessage('启动失败');
    } finally {
      // 只有当前操作ID匹配时才重置loading状态
      if (operationIdRef.current === currentOpId) {
        setRtsLoading(false);
        setRtsOperation(null);
        operationRef.current = null;
        setTimeout(() => {
          setRtsProgress(0);
          setRtsStageMessage('');
        }, 1000);
      }
    }
  }, [refreshRtsStatus]);

  // RTS 停止
  const stopRts = useCallback(async () => {
    // 分配新的操作ID
    const currentOpId = ++operationIdRef.current;
    setRtsLoading(true);
    setRtsOperation('stop');
    operationRef.current = 'stop';
    setRtsProgress(0);
    setRtsStageMessage('正在停止服务...');

    // 停止过程较快，进度条快速推进
    const progressInterval = setInterval(() => {
      setRtsProgress((prev) => {
        if (prev >= 90) return prev; // 停在 90%，等待真实完成
        return prev + 30; // 每次增加 30%，快速推进
      });
    }, 150); // 每 150ms 更新一次

    try {
      const res = await window.mainHandle.stopRTSServiceHandle();

      // 只有当前操作ID匹配时才更新状态
      if (operationIdRef.current !== currentOpId) {
        console.log('stop: 操作已被新操作取代，跳过状态更新');
        clearInterval(progressInterval);
        return;
      }

      setRtsProgress(100);
      setRtsStageMessage('服务已停止');

      if (!res.includes('success')) {
        message.warning('停止结果：' + res);
      }

      await refreshRtsStatus();
    } catch (error) {
      clearInterval(progressInterval);
      if (operationIdRef.current !== currentOpId) return;
      message.error('停止失败：' + error);
      setRtsStageMessage('停止失败');
    } finally {
      clearInterval(progressInterval);
      // 只有当前操作ID匹配时才重置loading状态
      if (operationIdRef.current === currentOpId) {
        setRtsLoading(false);
        setRtsOperation(null);
        operationRef.current = null;
        setTimeout(() => {
          setRtsProgress(0);
          setRtsStageMessage('');
        }, 1000);
      }
    }
  }, [refreshRtsStatus]);

  // 初始化和定时刷新 RTS 状态
  useEffect(() => {
    refreshRtsStatus();
    const interval = setInterval(() => {
      refreshRtsStatus();
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshRtsStatus]);

  // 监听 RTS 进度事件
  useEffect(() => {
    const unsubscribe = window.mainHandle.onRtsProgress((progress) => {
      console.log('Received RTS progress:', progress);
      // 路径过长错误：不管当前操作，直接设置错误并结束加载
      if (progress.stage === 'path_error') {
        setRtsErrorMessage(progress.message);
        setRtsLoading(false);
        setRtsOperation(null);
        operationRef.current = null;
        setRtsProgress(0);
        setRtsStageMessage('');
        return;
      }
      // 只有当前操作与进度事件类型匹配时才更新
      if (operationRef.current === progress.operation) {
        setRtsProgress(progress.percent);
        setRtsStageMessage(translateMessage(progress.message));
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 监听状态变化，当达到目标状态时自动结束加载并显示成功消息
  useEffect(() => {
    // 启动操作完成：状态变成 running
    if (rtsOperation === 'run' && rtsState === 'running') {
      message.success('RTS 服务启动成功！');
      setRtsProgress(100);
      setTimeout(() => {
        setRtsLoading(false);
        setRtsOperation(null);
        setTimeout(() => setRtsProgress(0), 500);
      }, 300);
    }
    // 停止操作完成：状态变成 stopped
    if (rtsOperation === 'stop' && rtsState === 'stopped') {
      message.success('RTS 服务已停止！');
      setRtsProgress(100);
      setTimeout(() => {
        setRtsLoading(false);
        setRtsOperation(null);
        setTimeout(() => setRtsProgress(0), 500);
      }, 300);
    }
  }, [rtsState, rtsOperation]);

  return {
    rtsState,
    rtsLoading,
    rtsProgress,
    rtsOperation,
    rtsStageMessage,
    rtsErrorMessage,
    clearRtsError,
    refreshRtsStatus,
    installRts,
    runRts,
    stopRts,
  };
}
