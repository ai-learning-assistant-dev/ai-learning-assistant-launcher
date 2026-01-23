import { Progress } from 'antd';
import type { DLCId } from '../../../main/dlc/type-info';
import { useEffect, useState } from 'react';

interface TorrentProgressData {
  percent: number;
  timeRemaining: number;
  downloadSpeed: number;
  downloaded: number;
  total: number;
}

export function TorrentProgress(props: { id: DLCId; version: string }) {
  const [progressData, setProgressData] = useState<TorrentProgressData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchProgress = async () => {
      try {
        const dlcIndex = await window.mainHandle.queryWebtorrentHandle();

        // 找到对应的 DLC 和版本
        const dlc = dlcIndex.find((item) => item.id === props.id);
        if (!dlc) {
          if (mounted) {
            setProgressData(null);
            setLoading(false);
          }
          return;
        }

        const versionInfo = dlc.versions[props.version];
        if (!versionInfo || !versionInfo.progress) {
          if (mounted) {
            setProgressData(null);
            setLoading(false);
          }
          return;
        }

        const torrent = versionInfo.progress;
        // WebTorrent.Torrent 对象应该包含这些属性
        const progress = torrent.progress || 0; // 0-1 之间的值
        const timeRemaining = torrent.timeRemaining || 0; // 毫秒
        const downloadSpeed = torrent.downloadSpeed || 0; // 字节/秒
        const downloaded = torrent.downloaded || 0; // 已下载字节
        const total = torrent.length || 0; // 总字节

        if (mounted) {
          setProgressData({
            percent: progress * 100,
            timeRemaining,
            downloadSpeed,
            downloaded,
            total,
          });
          setLoading(false);
        }
      } catch (error) {
        console.error('获取下载进度失败:', error);
        if (mounted) {
          setProgressData(null);
          setLoading(false);
        }
      }
    };

    // 立即获取一次
    fetchProgress();

    // 设置轮询，每2秒获取一次
    const intervalId = setInterval(fetchProgress, 2000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [props.id, props.version]);

  if (loading) {
    return <Progress percent={0} status="active" />;
  }

  if (!progressData) {
    return <Progress percent={0} status="exception" />;
  }

  const formatTime = (ms: number) => {
    if (ms === 0 || ms === Infinity) return '--';
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}小时${minutes}分${secs}秒`;
    } else if (minutes > 0) {
      return `${minutes}分${secs}秒`;
    } else {
      return `${secs}秒`;
    }
  };

  const formatSpeed = (bytesPerSecond: number) => {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return `${parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div>
      <Progress
        percent={progressData.percent}
        status={progressData.percent >= 100 ? 'success' : 'active'}
        showInfo={false}
      />
      {progressData.percent < 100 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: '#666',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <div>速度: {formatSpeed(progressData.downloadSpeed)}</div>
          <div>剩余时间: {formatTime(progressData.timeRemaining)}</div>
        </div>
      )}
    </div>
  );
}
