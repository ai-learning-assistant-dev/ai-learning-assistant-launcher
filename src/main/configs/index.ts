import { readFileSync } from "node:fs";
import path from "node:path";
import { appPath } from "../exec";

const containerConfigPath = path.join(
  appPath,
  'external-resources',
  'ai-assistant-backend',
  'container-config.json',
)

export interface ContainerConfig {
  "ASR": {
    "port": {
      "container": number,
      "host": number
    }[]
  },
  "TTS": {
    "port": {
      "container": number,
      "host": number
    }[]
  },
  "LLM": {
    "port": {
      "container": number,
      "host": number
    }[]
  }
}

let containerConfigBuff: ContainerConfig = {
  ASR: {port:[]},
  TTS: {port:[]},
  LLM: {port:[]},
};
export function getContainerConfig() {
  const containerConfigString = readFileSync(containerConfigPath, { encoding: 'utf8' });
  const containerConfig = JSON.parse(containerConfigString) as ContainerConfig;
  if (containerConfig) {
    containerConfigBuff = containerConfig;
  }
  return containerConfig;
}
