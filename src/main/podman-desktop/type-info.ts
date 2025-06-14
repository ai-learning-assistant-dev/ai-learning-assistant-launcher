export type ServiceName = "TTS" | "ASR" | "LLM";
export type ActionName = "query" | "install" | "start" | "stop" | "remove" | "update";

export const imageNameDict: Record<ServiceName, string> = {
  ASR: '',
  TTS: 'docker.io/library/ai-tts-2:latest',
  LLM: '',
};
