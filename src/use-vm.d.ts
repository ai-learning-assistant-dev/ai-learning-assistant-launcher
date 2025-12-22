import { ActionName, ServiceName } from '../src/main/cmd/type-info';

interface VMHookReturn {
  isPodmanInstalled: boolean;
  podmanChecking: boolean;
  podmanInfo: string;
  needResintallPodman: boolean;
  isWSLInstalled: boolean;
  wslVersion: string;
  wslChecking: boolean;
  wslLoading: boolean;
  wslOperation: {
    action: string;
    service: string;
  };
  handleCmdAction: (action: ActionName, service: ServiceName) => void;
  showRebootModal: boolean;
  vTReady: boolean;
}

declare module '@use-vm' {
  export function useVM(): VMHookReturn;
}