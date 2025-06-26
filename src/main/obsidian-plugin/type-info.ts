import type { Channels } from '../ipc-data-type';

export const pluginList = [
  'aloud-tts-ai-learning-assistant',
  'copilot-ai-learning-assistant',
  'whisper',
] as const

export type ServiceName = 'all' | typeof pluginList[number];
export type ActionName =
  | 'query'
  | 'install'
  | 'update';

export const channel: Channels = 'obsidian-plugin';

export interface ObsidianPlugin {
  id: string;
  name: string;
  version: string;
  latestVersion: string;
  isLatest: boolean;
  isInstalled: boolean;
}

const manifestSample = {
  "id": "aloud-tts-ai-learning-assistant",
  "name": "Aloud TTS (AI Learning Assistant)",
  "version": "0.7.0-rc1",
  "minAppVersion": "0.15.0",
  "description": "Highlight and speak text from your notes. Converts text to speech in real-time using lifelike voices from OpenAI. Development fork by AI Learning Assistant based on Adrian Lyjak's work.",
  "author": "AI Learning Assistant Dev (based on Adrian Lyjak's work)",
  "authorUrl": "https://github.com/ai-learning-assistant-dev",
  "fundingUrl": {
    "GitHub Repository": "https://github.com/ai-learning-assistant-dev/obsidian-aloud-tts",
    "Original Author Repository": "https://github.com/adrianlyjak/obsidian-aloud-tts"
  },
  "isDesktopOnly": false
}

export type PluginManifest = typeof manifestSample;