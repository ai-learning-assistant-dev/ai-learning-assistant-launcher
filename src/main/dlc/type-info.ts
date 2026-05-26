import type { Channels } from '../ipc-data-type';
import type WebTorrent from 'webtorrent';

export const channel: Channels = 'webtorrent';

export const startWebtorrentHandle = `${channel}start`;

export const pauseWebtorrentHandle = `${channel}pause`;

export const removeWebtorrentHandle = `${channel}remove`;

export const queryWebtorrentHandle = `${channel}query`;

export const logsWebtorrentHandle = `${channel}logs`;

export const setUploadEnabledHandle = `${channel}setUploadEnabled`;

export const getUploadEnabledHandle = `${channel}getUploadEnabled`;

export const getUploadStatsHandle = `${channel}getUploadStats`;

// HTTPS 多源下载相关
export const startHttpsDownloadHandle = `${channel}httpsStart`;
export const queryHttpsDownloadHandle = `${channel}httpsQuery`;
export const cancelHttpsDownloadHandle = `${channel}httpsCancel`;
export const checkHttpsDownloadFileHandle = `${channel}httpsCheckFile`;

// HTTPS 下载进度信息
export interface HttpsDownloadProgress {
  dlcId: DLCId;
  version: string;
  progress: number; // 0-1
  downloadedBytes: number;
  totalBytes: number;
  speed: number; // bytes/s
  status: 'idle' | 'downloading' | 'completed' | 'error' | 'cancelled';
  error?: string;
  filePath?: string;
}

// HTTPS 下载状态存储（key 为 dlcId）
export type HttpsDownloadState = Record<string, HttpsDownloadProgress>;

export const dLCIds = [
  'PDF_TAR',
  'VOICE_TAR',
  'TRAINING_SOURCE',
  'TRAINING_TAR',
  'TRAINING_VOICE_TAR',
  'TRAINING_COURSE',
  'LMSTUDIO_WINDOWS',
  'AI_LEARNING_ASSISTANT_LAUNCHER',
  'OBSIDIAN_SETUP_EXE',
  'LM_STUDIO_SETUP_EXE',
  'TEST_FILE',
  'TEXTBOOK_EDITOR_SOURCE',
] as const;

export type DLCId = (typeof dLCIds)[number];

export type OneDLCInfo = {
  id: DLCId;
  name: string;
  versions: Record<
    string,
    {
      magnet: string;
      http: string;
      progress?: WebTorrent.Torrent;
      comment?: string;
      require: Partial<Record<DLCId, string>>;
    }
  >;
};

export type DLCIndex = OneDLCInfo[];
