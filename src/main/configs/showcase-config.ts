import { ActionName, ServiceName, channel } from './type-info';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath } from '../exec';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';

const showcaseConfigPath = path.join(
  appPath,
  'external-resources',
  'config',
  'showcase-config.json',
);

export interface ShowcaseItem {
  id: string;
  title: string;
  description: string;
  link: string;
}

export interface ShowcaseConfig {
  items: ShowcaseItem[];
}

export async function showcaseConfig(
  event: Electron.IpcMainEvent,
  action: ActionName,
  serviceName: ServiceName,
  extraData?: any,
) {
  try {
    console.debug('showcaseConfig called with:', { action, serviceName, extraData });

    if (action === 'query' && serviceName === 'showcase') {
      // 读取配置文件
      const configString = readFileSync(showcaseConfigPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as ShowcaseConfig;
      
      event.reply(
        channel,
        MESSAGE_TYPE.DATA,
        new MessageData(action, serviceName, config)
      );
    } else if (action === 'update' && serviceName === 'showcase') {
      // 重新读取配置文件
      const configString = readFileSync(showcaseConfigPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as ShowcaseConfig;
      
      event.reply(
        channel,
        MESSAGE_TYPE.INFO,
        '配置已刷新'
      );
      
      event.reply(
        channel,
        MESSAGE_TYPE.DATA,
        new MessageData(action, serviceName, config)
      );
    } else if (action === 'addWorkspace' && serviceName === 'showcase') {
      console.debug('Processing addWorkspace action');
      // 添加新的工作区配置
      const newWorkspace = extraData;
      console.debug('New workspace data:', newWorkspace);
      
      // 读取当前配置
      const configString = readFileSync(showcaseConfigPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as ShowcaseConfig;
      console.debug('Current config before adding:', config);
      
      // 添加新的工作区
      config.items.push(newWorkspace);
      console.debug('Config after adding new workspace:', config);
      
      // 写回配置文件
      writeFileSync(showcaseConfigPath, JSON.stringify(config, null, 2), {
        encoding: 'utf8',
      });
      console.debug('Config file written successfully');
      
      event.reply(
        channel,
        MESSAGE_TYPE.INFO,
        '工作区添加成功'
      );
      
      event.reply(
        channel,
        MESSAGE_TYPE.DATA,
        new MessageData(action, serviceName, config)
      );
    }
  } catch (error) {
    console.error('Error in showcaseConfig:', error);
    event.reply(
      channel,
      MESSAGE_TYPE.ERROR,
      `Showcase配置操作失败: ${error.message}`,
    );
  }

  return true;
} 