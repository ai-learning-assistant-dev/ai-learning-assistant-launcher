import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appPath } from "../exec";
import { dialog, IpcMain } from "electron";
import { ActionName, channel, ServiceName } from "./type-info";
import { isWindows } from "../exec/util";
import { MESSAGE_TYPE, MessageData } from "../ipc-data-type";


export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      console.debug(
        `configs action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      if (isWindows()) {
        if (action === 'query') {
          if(serviceName === 'obsidianApp') {
            console.debug('obsidianApp')
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, getObsidianConfig()),
            );
          }
        }else if(action === 'update'){
          if(serviceName === 'obsidianApp'){
            const result = await dialog.showOpenDialog({ properties: ['openFile'] });
            const path = result.filePaths[0]
            if(path && path.length>0){
              const obsidianConfig = getObsidianConfig();
              obsidianConfig.obsidianApp.bin = path;
              setObsidianConfig(obsidianConfig);
              event.reply(
                channel,
                MESSAGE_TYPE.INFO,
                "成功设置Obsidian路径",
              );
            }else{
              event.reply(
                channel,
                MESSAGE_TYPE.INFO,
                "没有设置好Obsidian路径",
              );
            }
          }
        }
      }
    }
  )
}

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


const obsidianConfigPath = path.join(
  appPath,
  'external-resources',
  'config',
  'obsidian-config.json',
)

export interface ObsidianConfig {
  "obsidianApp": {
    "bin": string,
  };
}


let obsidianConfigBuff: ObsidianConfig = {
  "obsidianApp": {
    "bin": "C:/a/b/c"
  }
};
export function getObsidianConfig(){
  const obsidianConfigPathString = readFileSync(obsidianConfigPath, { encoding: 'utf8' });
  const obsidianConfig = JSON.parse(obsidianConfigPathString) as ObsidianConfig;
  if (obsidianConfig) {
    obsidianConfigBuff = obsidianConfig;
  }
  return obsidianConfig;
}

export function setObsidianConfig(config){
  writeFileSync(obsidianConfigPath, JSON.stringify(config,null,2) ,{ encoding: 'utf8'})
}