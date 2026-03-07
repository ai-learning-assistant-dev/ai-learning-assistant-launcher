import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';

export type RtsOperation = 'install' | 'run' | 'stop' | null;

export interface UseRtsServiceReturn {
  rtsState: string;
  rtsLoading: boolean;
  rtsProgress: number;
  rtsOperation: RtsOperation;
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
    setRtsProgress(0);

    const progressInterval = setInterval(() => {
      setRtsProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + 10;
      });
    }, 500);

    try {
      const res = await window.mainHandle.installRTSServiceHandle();
      console.log('install RTS service result:', res);
      setRtsProgress(100);

      if (res.includes('success')) {
        message.success('RTS 服务安装成功！');
        await refreshRtsStatus();
      } else {
        message.warning('安装完成，但可能有问题：' + res);
        await refreshRtsStatus();
      }
    } catch (error) {
      message.error('安装失败：' + error);
    } finally {
      clearInterval(progressInterval);
      setRtsLoading(false);
      setRtsOperation(null);
      setTimeout(() => setRtsProgress(0), 1000);
    }
  }, [refreshRtsStatus]);

  // RTS 启动
  const runRts = useCallback(async () => {
    setRtsLoading(true);
    setRtsOperation('run');
    setRtsProgress(0);

    // 启动过程较慢，进度条更平缓
    const progressInterval = setInterval(() => {
      setRtsProgress((prev) => {
        if (prev >= 85) return prev; // 停在 85%，等待真实完成
        return prev + 5; // 每次增加 5%
      });
    }, 400); // 每 400ms 更新一次

    try {
      const res = await window.mainHandle.runRTSServiceHandle();
      console.log('run RTS service result: ', res);
      setRtsProgress(100);

      if (!res.includes('success')) {
        message.error('启动失败：' + res);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      await refreshRtsStatus();
    } catch (error) {
      message.error('启动失败：' + error);
    } finally {
      clearInterval(progressInterval);
      setRtsLoading(false);
      setRtsOperation(null);
      setTimeout(() => setRtsProgress(0), 1000);
    }
  }, [refreshRtsStatus]);

  // RTS 停止
  const stopRts = useCallback(async () => {
    setRtsLoading(true);
    setRtsOperation('stop');
    setRtsProgress(0);

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

      if (!res.includes('success')) {
        message.warning('停止结果：' + res);
      }

      await refreshRtsStatus();
    } catch (error) {
      message.error('停止失败：' + error);
    } finally {
      clearInterval(progressInterval);
      setRtsLoading(false);
      setRtsOperation(null);
      setTimeout(() => setRtsProgress(0), 1000);
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
    refreshRtsStatus,
    installRts,
    runRts,
    stopRts,
  };
}
