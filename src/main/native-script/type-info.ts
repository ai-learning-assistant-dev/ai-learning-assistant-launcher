const nativeServiceNames = [
  'NATIVE_TRAINING',
  'NATIVE_TRAINING_RTS',
  'NATIVE_OBSIDIAN_VOICE',
  'TEXTBOOK_EDITOR',
] as const;

export type NativeServiceName = (typeof nativeServiceNames)[number];

export interface NativeServiceItem {
  state: '还未安装' | '已经停止' | '正在运行' | '正在启动';
  port: number;
}

export interface NativeServiceInfo {
  /**
   * 服务状态
   * install_exited和exited和uninstall_exited都表示异常退出
   */
  state:
    | 'not_install'
    | 'installing'
    | 'install_exited'
    | 'stopped'
    | 'starting'
    | 'running'
    | 'exited'
    | 'updating'
    | 'update_exited'
    | 'uninstalling'
    | 'uninstall_exited';
  /** 安装进度 */
  installProgress?: number;
  /** 业务执行进度 */
  processProgress?: number;
  exitCode?: number;
  /** 端口 */
  ports?: number[];
  /** 版本号 */
  version?: string;
}

export const TRAINING_PORT = 7100;

export const TRAINING_SHUTDOWN_URL = `http://localhost:${TRAINING_PORT}/shutdown`;

// 远程仓库URL和分支
export const TRAINING_REPO_URL =
  'https://gitee.com/shiftonetothree/ai-learning-assistant-training-server.git';
export const TRAINING_REPO_BRANCH = 'release';

export const TEXTBOOK_EDITOR_PORT = 7200;

export const TEXTBOOK_EDITOR_SHUTDOWN_URL = `http://localhost:${TEXTBOOK_EDITOR_PORT}/shutdown`;
