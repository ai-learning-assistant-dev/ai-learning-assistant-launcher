import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';

export type ObsidianVoiceOperation = 'install' | 'run' | 'stop' | null;

export interface UseObsidianVoiceServiceReturn {
  voiceState: string;
  voiceLoading: boolean;
  voiceProgress: number;
  voiceOperation: ObsidianVoiceOperation;
  refreshVoiceStatus: () => Promise<string>;
  installVoiceService: () => Promise<void>;
  runVoiceService: () => Promise<void>;
  stopVoiceService: () => Promise<void>;
}

export function useObsidianVoiceService(): UseObsidianVoiceServiceReturn {
  const [voiceState, setVoiceState] = useState('');
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [voiceOperation, setVoiceOperation] =
    useState<ObsidianVoiceOperation>(null);

  const refreshVoiceStatus = useCallback(async () => {
    try {
      const state = await window.mainHandle.getObsidianVoiceServiceStatusHandle();
      setVoiceState(state);
      return state;
    } catch (error) {
      console.error('获取 obsidian-voice-service 状态失败:', error);
      return '';
    }
  }, []);

  const installVoiceService = useCallback(async () => {
    setVoiceLoading(true);
    setVoiceOperation('install');
    setVoiceProgress(10);

    try {
      const result = await window.mainHandle.installObsidianVoiceServiceHandle();
      setVoiceProgress(100);

      if (result.includes('success')) {
        message.success('obsidian-voice-service 安装成功');
      } else {
        message.warning(`安装返回: ${result}`);
      }

      await refreshVoiceStatus();
    } catch (error) {
      message.error(`安装失败: ${error}`);
    } finally {
      setVoiceLoading(false);
      setVoiceOperation(null);
      setTimeout(() => setVoiceProgress(0), 800);
    }
  }, [refreshVoiceStatus]);

  const runVoiceService = useCallback(async () => {
    setVoiceLoading(true);
    setVoiceOperation('run');
    setVoiceProgress(10);

    try {
      const result = await window.mainHandle.runObsidianVoiceServiceHandle();
      setVoiceProgress(100);

      if (result.includes('success')) {
        message.success('obsidian-voice-service 启动成功');
      } else {
        message.error(`启动返回: ${result}`);
      }

      await refreshVoiceStatus();
    } catch (error) {
      message.error(`启动失败: ${error}`);
    } finally {
      setVoiceLoading(false);
      setVoiceOperation(null);
      setTimeout(() => setVoiceProgress(0), 800);
    }
  }, [refreshVoiceStatus]);

  const stopVoiceService = useCallback(async () => {
    setVoiceLoading(true);
    setVoiceOperation('stop');
    setVoiceProgress(10);

    try {
      const result = await window.mainHandle.stopObsidianVoiceServiceHandle();
      setVoiceProgress(100);

      if (result.includes('success')) {
        message.success('obsidian-voice-service 已停止');
      } else {
        message.warning(`停止返回: ${result}`);
      }

      await refreshVoiceStatus();
    } catch (error) {
      message.error(`停止失败: ${error}`);
    } finally {
      setVoiceLoading(false);
      setVoiceOperation(null);
      setTimeout(() => setVoiceProgress(0), 800);
    }
  }, [refreshVoiceStatus]);

  useEffect(() => {
    refreshVoiceStatus();
    const interval = setInterval(refreshVoiceStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshVoiceStatus]);

  return {
    voiceState,
    voiceLoading,
    voiceProgress,
    voiceOperation,
    refreshVoiceStatus,
    installVoiceService,
    runVoiceService,
    stopVoiceService,
  };
}
