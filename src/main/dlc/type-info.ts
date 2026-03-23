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

export const dLCIds = [
  'PDF_TAR',
  'VOICE_TAR',
  'TRAINING_TAR',
  'TRAINING_VOICE_TAR',
  'TRAINING_COURSE',
  'LMSTUDIO_WINDOWS',
  'AI_LEARNING_ASSISTANT_LAUNCHER',
  'OBSIDIAN_SETUP_EXE',
  'LM_STUDIO_SETUP_EXE',
  'TEST_FILE',
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
      riquire: Record<string, string>;
    }
  >;
};

export type DLCIndex = OneDLCInfo[];
