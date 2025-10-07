import { useCallback, useEffect, useState } from 'react';
import { notification } from 'antd';
import { MESSAGE_TYPE, MessageData } from '../../../main/ipc-data-type';
import {
  ObsidianConfig,
  ObsidianVaultConfig,
  ActionName,
  channel,
  ServiceName,
  ContainerConfig,
  VoiceConfigFile,
  LLMConfig
} from '../../../main/configs/type-info';
import { channel as cmdChannel } from '../../../main/cmd/type-info';

export default function useConfigs() {
  const [obsidianConfig, setObsidianConfig] = useState<ObsidianConfig>();
  const [obsidianVaultConfig, setObsidianVaultConfig] =
    useState<ObsidianVaultConfig[]>();
  const [containerConfig, setContainerConfig] = useState<ContainerConfig>();
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfigFile>();
  const [llmConfig, setLlmConfig] = useState<LLMConfig>();
  const [loading, setLoading] = useState(false);
  const [selectedVoiceFile, setSelectedVoiceFile] = useState<string | null>(null);
  const [voiceFileList, setVoiceFileList] = useState<string[]>([]);
  const [testingResult, setTestingResult] = useState<{success: boolean, message: string} | null>(null);
  
  function action(
    actionName: ActionName,
    serviceName: ServiceName,
    extraData?: any,
  ) {
    if (loading) {
      notification.warning({
        message: '请等待上一个操作完成后再操作',
        placement: 'topRight',
      });
      return;
    }
    setLoading(true);
    window.electron.ipcRenderer.sendMessage(
      channel,
      actionName,
      serviceName,
      extraData,
    );
  }

  const query = useCallback(() => {
    window.electron.ipcRenderer.sendMessage(cmdChannel, 'query', 'obsidianApp');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'obsidianApp');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'obsidianVault');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'container');
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'LLM');
  }, []);
  
  const queryVoice = useCallback((modelType: 'gpu' | 'cpu' = 'gpu') => {
    window.electron.ipcRenderer.sendMessage(channel, 'query', 'TTS', {
      modelType,
    });
  }, []);
  
  const initVoiceFileList = useCallback((modelType: 'gpu' | 'cpu' = 'gpu') => {
    window.electron.ipcRenderer.sendMessage(channel, 'initVoiceFileList', 'TTS', {
      modelType,
    });
  }, []);
  
  const deleteVoiceFile = useCallback((filename: string) => {
    window.electron.ipcRenderer.sendMessage(channel, 'deleteVoiceFile', 'TTS', {
      filename,
    });
  }, []);
  
  useEffect(() => {
    const cancel = window.electron?.ipcRenderer.on(
      channel,
      (messageType, data) => {
        console.debug(messageType, data);
        if (messageType === MESSAGE_TYPE.ERROR) {
          notification.error({
            message: data as string,
            placement: 'topRight',
          });
          setLoading(false);
        } else if (messageType === MESSAGE_TYPE.DATA) {
          const {
            action: actionName,
            service,
            data: payload,
          } = data as MessageData;
          if (actionName === 'query' && service === 'obsidianApp') {
            console.debug('payload', payload);
            setObsidianConfig(payload);
            setLoading(false);
          } else if (actionName === 'query' && service === 'obsidianVault') {
            console.debug('payload', payload);
            setObsidianVaultConfig(payload);
            setLoading(false);
          } else if (actionName === 'query' && service === 'container') {
            console.debug('payload', payload);
            setContainerConfig(payload);
            setLoading(false);
          } else if (actionName === 'query' && service === 'TTS') {
            console.debug('voice payload', payload);
            setVoiceConfig(payload);
            setLoading(false);
          } else if (actionName === 'query' && service === 'LLM') {
            console.debug('llm payload', payload);
            setLlmConfig(payload);
            setLoading(false);
          } else if (actionName === 'testConnection' && service === 'LLM') {
            console.debug('test connection payload', payload);
           // 处理测试连接结果
            setTestingResult({
              success: payload.success,
              message: payload.message
            });
            
            if (payload.success) {
              notification.success({
                message: payload.message,
                placement: 'topRight',
              });
            } else {
              notification.error({
                message: payload.message,
                placement: 'topRight',
              });    
            }
            setLoading(false);
          }else if (actionName === 'selectVoiceFile' && service === 'TTS') {
            console.debug('selected voice file payload', payload);
            if (payload.canceled) {
              // 用户取消选择，只重置loading状态
              setLoading(false);
            } else {
              // 用户选择了文件
              setSelectedVoiceFile(payload.filename);
              setLoading(false);
              // 清理状态，避免重复创建
              setTimeout(() => setSelectedVoiceFile(null), 100);
            }
          } else if (actionName === 'initVoiceFileList' && service === 'TTS') {
            console.debug('voice file list payload', payload);
            setVoiceFileList(payload.fileList || []);
            setLoading(false);
          }
        } else if (messageType === MESSAGE_TYPE.INFO) {
          notification.success({
            message: data as string,
            placement: 'topRight',
          });
          query();
          setLoading(false);
        } else if (messageType === MESSAGE_TYPE.PROGRESS) {
          notification.success({
            message: data as string,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.PROGRESS_ERROR) {
          notification.error({
            message: data as string,
            placement: 'topRight',
          });
        } else if (messageType === MESSAGE_TYPE.WARNING) {
          notification.warning({
            message: data as string,
            placement: 'topRight',
          });
        }
      },
    );

    return () => {
      cancel();
    };
  }, [setObsidianConfig, setObsidianVaultConfig]);

  useEffect(() => {
    query();
  }, [query]);

  return {
    action,
    obsidianConfig,
    obsidianVaultConfig,
    containerConfig,
    voiceConfig,
    llmConfig,
    loading,
    queryVoice,
    selectedVoiceFile,
    voiceFileList,
    initVoiceFileList,
    deleteVoiceFile,
    testingResult
  };
}
