import { ActionName, ServiceName } from '../../../main/cmd/type-info';

// 测试环境的mock版本useVM hook
export function useVM() {
  // 测试模式下直接返回模拟的已安装状态
  return {
    isPodmanInstalled: true,
    podmanChecking: false,
    podmanInfo: '',
    needResintallPodman: false,
    isWSLInstalled: true,
    wslVersion: 'WSL 2',
    wslChecking: false,
    wslLoading: false,
    wslOperation: { action: '', service: '' },
    handleCmdAction: (action: ActionName, service: ServiceName) => {
      console.log(`Mock handleCmdAction: ${action} ${service}`);
    },
    showRebootModal: false,
    vTReady: true,
  };
}