export const getRTSServiceStatusHandle = 'getRTSServiceStatus';
export const installRTSServiceHandle = 'installRTSService';
export const runRTSServiceHandle = 'runRTSService';
export const stopRTSServiceHandle = 'stopRTSService';

// RTS 进度事件通道
export const rtsProgressChannel = 'rts-progress';

// 进度信息类型
export interface RTSProgressInfo {
  type: 'progress';
  percent: number;
  stage: string;
  message: string;
  operation: 'install' | 'run';
}
