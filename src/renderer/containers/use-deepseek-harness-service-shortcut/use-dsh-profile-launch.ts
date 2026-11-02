import { useCallback, useEffect, useState } from 'react';
import type {
  DshProfileInfo,
  DshProfileLaunchResult,
} from '../../../main/deepseek-harness-service/type-info';

/** 把未知错误转成可展示的文本 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  try {
    return JSON.stringify(error) || '未知错误';
  } catch {
    return String(error);
  }
}

/**
 * 「按 profile 启动 dsh」专用的状态容器。
 *
 * 那一份负责安装 / 卸载 / 服务状态，跟这里的 profile 列表没有耦合；
 * 这里不碰 `serviceInfo`，只依赖外部传入的 `installed`。
 */
export function useDshProfileLaunch(installed: boolean) {
  const [profiles, setProfiles] = useState<DshProfileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 读一次磁盘上的 profile 列表；错误只留在这里给界面展示，不弹全局提示 */
  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.mainHandle.listDshProfilesHandle();
      setProfiles(list);
      setError(null);
    } catch (e) {
      console.error('[DeepSeekHarness] 读取 dsh profile 列表失败:', e);
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 只在“已安装”时才去读；安装完成的那一刻会自动拉一次
  useEffect(() => {
    if (!installed) {
      setProfiles([]);
      return;
    }
    void loadProfiles();
  }, [installed, loadProfiles]);

  /**
   * 启动某个 profile。成功只代表命令已发出（dsh 会自己打开浏览器）。
   * 抛错交给调用方弹提示，这里只维护 loading 态。
   */
  const launch = useCallback(
    async (name: string): Promise<DshProfileLaunchResult> => {
      setLaunching(name);
      try {
        return await window.mainHandle.launchDshProfileHandle(name);
      } finally {
        setLaunching(null);
      }
    },
    [],
  );

  return {
    profiles,
    loading,
    error,
    launching,
    loadProfiles,
    launch,
  };
}
