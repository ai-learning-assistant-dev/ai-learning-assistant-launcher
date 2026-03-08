import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';

export type RtsOperation = 'install' | 'run' | 'stop' | null;

// 英文消息到中文的翻译映射
const messageTranslations: Record<string, string> = {
  // run.ps1 messages
  'Checking uv package manager...': '检查 uv 包管理器...',
  'uv not found, please install first': 'uv 未找到，请先执行安装',
  'uv found': 'uv 已找到',
  'Starting service process...': '正在启动服务进程...',
  'Waiting for service to start...': '等待服务启动...',
  'Process exited unexpectedly': '进程异常退出',
  'RTS service started': 'RTS 服务已启动',
  'Service start timeout': '服务启动超时',
  'Entering service directory...': '进入服务目录...',
  'Checking and syncing dependencies...': '检查并同步依赖...',
  'Dependency sync may have issues, continuing...':
    '依赖同步可能有问题，继续启动...',
  'Dependencies check complete': '依赖检查完成',
  // install.ps1 messages
  'uv installed': 'uv 已安装',
  'Installing uv package manager...': '正在安装 uv 包管理器...',
  'uv installation complete': 'uv 安装完成',
  'uv install may have issues, trying to continue...':
    'uv 安装可能有问题，继续尝试...',
  'Code package exists, skipping download': '代码包已存在，跳过下载',
  'Downloading RTS code package...': '正在下载 RTS 代码包...',
  'Code package download complete': '代码包下载完成',
  'Code already extracted, skipping': '代码已解压，跳过',
  'Updating config files...': '更新配置文件...',
  'Config update complete': '配置更新完成',
  'Extracting code package...': '正在解压代码包...',
  'Code extraction complete': '代码解压完成',
  'Installation complete': '安装完成',
  'Dependencies synced, skipping': '依赖已同步，跳过',
  'Syncing dependencies...': '开始同步依赖环境...',
  'Dependencies sync complete': '依赖同步完成',
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
    return `等待服务就绪... (${waitingMatch[1]}秒)`;
  }
  // 模型加载消息
  if (msg.startsWith('Loading models:')) {
    const detail = msg.replace('Loading models:', '').trim();
    // 截取前60个字符避免显示过长
    const shortDetail =
      detail.length > 60 ? detail.substring(0, 60) + '...' : detail;
    return `模型加载中: ${shortDetail}`;
  }
  // 错误消息匹配
  if (msg.startsWith('Start failed:')) {
    return msg.replace('Start failed:', '启动失败:');
  }
  if (msg.startsWith('Download failed:')) {
    return msg.replace('Download failed:', '下载失败:');
  }
  if (msg.startsWith('Installation failed:')) {
    return msg.replace('Installation failed:', '安装失败:');
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
    setRtsLoading(true);
    setRtsOperation('install');
    operationRef.current = 'install';
    setRtsProgress(0);
    setRtsStageMessage('准备开始安装...');

    try {
      const res = await window.mainHandle.installRTSServiceHandle();
      console.log('install RTS service result:', res);
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
      message.error('安装失败：' + error);
      setRtsStageMessage('安装失败');
    } finally {
      setRtsLoading(false);
      setRtsOperation(null);
      operationRef.current = null;
      setTimeout(() => {
        setRtsProgress(0);
        setRtsStageMessage('');
      }, 1000);
    }
  }, [refreshRtsStatus]);

  // RTS 启动
  const runRts = useCallback(async () => {
    setRtsLoading(true);
    setRtsOperation('run');
    operationRef.current = 'run';
    setRtsProgress(0);
    setRtsStageMessage('准备启动服务...');

    try {
      const res = await window.mainHandle.runRTSServiceHandle();
      console.log('run RTS service result: ', res);
      setRtsProgress(100);
      setRtsStageMessage('服务已启动');

      if (!res.includes('success')) {
        message.error('启动失败：' + res);
        setRtsStageMessage('启动失败');
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      await refreshRtsStatus();
    } catch (error) {
      message.error('启动失败：' + error);
      setRtsStageMessage('启动失败');
    } finally {
      setRtsLoading(false);
      setRtsOperation(null);
      operationRef.current = null;
      setTimeout(() => {
        setRtsProgress(0);
        setRtsStageMessage('');
      }, 1000);
    }
  }, [refreshRtsStatus]);

  // RTS 停止
  const stopRts = useCallback(async () => {
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
      setRtsProgress(100);
      setRtsStageMessage('服务已停止');

      if (!res.includes('success')) {
        message.warning('停止结果：' + res);
      }

      await refreshRtsStatus();
    } catch (error) {
      message.error('停止失败：' + error);
      setRtsStageMessage('停止失败');
    } finally {
      clearInterval(progressInterval);
      setRtsLoading(false);
      setRtsOperation(null);
      operationRef.current = null;
      setTimeout(() => {
        setRtsProgress(0);
        setRtsStageMessage('');
      }, 1000);
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
