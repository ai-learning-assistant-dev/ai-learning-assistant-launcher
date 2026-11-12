import { useEffect, useMemo, useState } from 'react';
import { Button, Select, message } from 'antd';
import {
  getErrorMessage,
  useDshProfileLaunch,
} from '../../containers/use-deepseek-harness-service-shortcut/use-dsh-profile-launch';
import './dsh-profile-launcher.scss';

/**
 * 用户上次选的 profile。只影响这个组件：桌面版永远用 desktop，不受它影响。
 */
const STORAGE_KEY = 'native-ai-service.dsh-launch-profile';

/** 读上次的选择；localStorage 不可用（隐私模式等）时退回空串 */
function readSavedProfile(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveProfile(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // 存不住就只是下次不记得，不影响启动
  }
}

/**
 * 「选 profile → 启动」这一小块界面。
 *
 * 只负责触发启动命令：dsh 在新控制台里跑起来后会自己打开浏览器，进程归用户，
 * 所以这里没有停止按钮，也没有“运行中”状态。
 */
export function DshProfileLauncher({ installed }: { installed: boolean }) {
  const { profiles, loading, error, launching, loadProfiles, launch } =
    useDshProfileLaunch(installed);
  const [selected, setSelected] = useState<string>(readSavedProfile);

  const launchable = useMemo(
    () => profiles.filter((item) => !item.unavailableReason),
    [profiles],
  );

  // 上次的选择可能已被删除或变得不可启动，这时退回第一个能启动的
  useEffect(() => {
    if (launchable.length === 0) {
      return;
    }
    if (launchable.some((item) => item.name === selected)) {
      return;
    }
    setSelected(launchable[0].name);
  }, [launchable, selected]);

  if (!installed) {
    return null;
  }

  const current = profiles.find((item) => item.name === selected);
  const canLaunch = Boolean(current) && !launching;
  const busy = launching !== null;

  const handleChange = (value: string) => {
    setSelected(value);
    saveProfile(value);
  };

  const handleLaunch = async () => {
    if (!current) {
      return;
    }
    try {
      const result = await launch(current.name);
      message.success(
        `已按 profile「${result.profile}」发出启动命令，稍后会弹出命令窗口并在浏览器中打开`,
      );
    } catch (e) {
      message.error(`启动失败：${getErrorMessage(e)}`);
    }
  };

  const options = profiles.map((item) => ({
    value: item.name,
    // 不可启动的两类在选项里就直接写清楚原因，避免用户点了一个没反应的项
    label: item.unavailableReason
      ? `${item.name} · ${
          item.name === 'desktop' ? '桌面版独占' : '无图形界面'
        }`
      : `${item.name}${item.pluginCount > 0 ? `（${item.pluginCount} 个插件）` : ''}`,
    disabled: Boolean(item.unavailableReason),
  }));

  return (
    <div className="dsh-profile-launcher">
      <span className="dsh-profile-launcher-label">启动 profile</span>
      <Select
        className="dsh-profile-launcher-select"
        size="small"
        value={selected || undefined}
        placeholder={loading ? '读取中...' : '没有可启动的 profile'}
        loading={loading}
        options={options}
        onChange={handleChange}
        disabled={busy}
        popupMatchSelectWidth={false}
      />
      <Button
        size="small"
        type="primary"
        className="dsh-profile-launcher-button"
        loading={Boolean(launching) && launching === selected}
        disabled={!canLaunch}
        onClick={handleLaunch}
      >
        启动
      </Button>
      <Button
        size="small"
        type="link"
        className="dsh-profile-launcher-refresh"
        loading={loading}
        disabled={busy}
        onClick={() => void loadProfiles()}
      >
        刷新列表
      </Button>
      {error ? (
        <span className="dsh-profile-launcher-warn">读取失败：{error}</span>
      ) : (
        <span className="dsh-profile-launcher-hint">
          {profiles.length === 0 && !loading
            ? '磁盘上还没有任何 profile，先打开一次桌面版或运行 dsh --from-default-profile web'
            : '启动的是该 profile 自己的插件与模型；弹出的命令窗口别关，关掉即结束它'}
        </span>
      )}
    </div>
  );
}
