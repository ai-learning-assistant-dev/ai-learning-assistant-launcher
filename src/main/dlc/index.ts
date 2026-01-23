import { IpcMain } from 'electron';
import {
  logsWebtorrentHandle,
  startWebtorrentHandle,
  queryWebtorrentHandle,
  pauseWebtorrentHandle,
  removeWebtorrentHandle,
  DLCIndex,
  DLCId,
  OneDLCInfo,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import WebTorrent, * as allExports from 'webtorrent';
import path from 'path';
import { appPath } from '../exec';
import fs, { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { compare } from 'semver';

let client: WebTorrent.Instance | null = null;
const getWebTorrent = async () => {
  const WebTorrentClass: WebTorrent.WebTorrent =
    // @ts-ignore
    (await allExports.default).default;

  const iceServers = [{ urls: 'stun:learning.panchuantech.cn:19244' }];
  // try {
  //   const ac = new AbortController();
  //   const t = setTimeout(ac.abort, 3000);
  //   const stuns = await (
  //     await fetch(
  //       'https://hub.gitmirror.com/raw.githubusercontent.com/pradt2/always-online-stun/master/valid_hosts.txt',
  //       { signal: ac.signal },
  //     )
  //   ).text();
  //   clearTimeout(t);
  //   iceServers = stuns.split('\n').map((urls) => ({ urls }));
  // } catch (error) {
  //   console.log('获取公共stun失败，使用默认stun');
  // }
  console.log(iceServers);

  client = new WebTorrentClass({
    lsd: true,
    tracker: {
      // WebRTC 相关的配置放在这里
      rtcConfig: {
        iceServers,
      } as RTCConfiguration,
      announce: ['wss://learning.panchuantech.cn/announce'],
    },
  });

  return client;
};

// const getWebTorrent = async () => {
//   // @ts-ignore
//   return new WebTorrent();
// };

export default async function init(ipcMain: IpcMain) {
  client = await getWebTorrent();
  ipcHandle(ipcMain, startWebtorrentHandle, async (_event, magnet: string) =>
    startWebtorrent(magnet),
  );
  ipcHandle(ipcMain, queryWebtorrentHandle, async (_event) =>
    queryWebtorrent(),
  );
  ipcHandle(ipcMain, pauseWebtorrentHandle, async (_event, magnet: string) =>
    pauseWebtorrent(magnet),
  );
  ipcHandle(ipcMain, removeWebtorrentHandle, async (_event, magnet: string) =>
    removeWebtorrent(magnet),
  );
  ipcHandle(ipcMain, logsWebtorrentHandle, async (_event, magnet: string) =>
    logsWebtorrent(magnet),
  );
  // 检查种子文件和对应的实际文件，如果有文件，就添加到webtorrent中
  await restoreTorrentsFromFiles();
}

export async function startWebtorrent(magnet: string) {
  const torrent = await client.get(magnet);
  const dLCInfo = getIndexVersionByMegnet(magnet);
  if (dLCInfo) {
    const filePath = path.join(
      appPath,
      'external-resources',
      'dlc',
      dLCInfo.dlc.id,
      dLCInfo.version,
    );
    if (!existsSync(filePath)) {
      mkdirSync(filePath, { recursive: true });
    }
    if (torrent) {
      torrent.on('metadata', () => {
        saveTorrentFile(filePath, torrent);
      });
      console.debug('种子文件已经存在，继续下载');
      torrent.resume();
      return torrent;
    } else {
      return client.add(
        magnet,
        {
          path: filePath,
        },
        (torrent) => {
          // Got torrent metadata!
          console.debug('Client is downloading:', torrent.infoHash);
          console.debug(`[add] 开始下载 ${torrent.name}`);
          console.debug(`[add] 存储地址 ${torrent.path}`);
          saveTorrentFile(filePath, torrent);
        },
      );
    }
  } else {
    console.warn('没找到链接对应的索引信息', magnet);
  }
}

// Every time we resolve a magnet URI, save the torrent file so that we can use
// it on next startup. Starting with the full torrent metadata will be faster
// than re-fetching it from peers using ut_metadata.
async function saveTorrentFile(
  torrentBasePath: string,
  torrent: WebTorrent.Torrent,
) {
  const torrentPath = path.join(torrentBasePath, torrent.infoHash + '.torrent');

  try {
    fs.accessSync(torrentPath, fs.constants.R_OK);
    return torrentPath;
  } catch (err) {
    // Otherwise, save the .torrent file, under the app config folder
    fs.mkdirSync(torrentBasePath, { recursive: true });
    fs.writeFileSync(torrentPath, torrent.torrentFile);
    console.debug('保存种子文件成功', torrentPath);
    return torrentPath;
  }
}

export async function queryWebtorrent() {
  return getDLCIndex();
}

export async function pauseWebtorrent(magnet: string) {
  const torrent = await client.get(magnet);
  if (torrent) {
    torrent.pause();
  }
}

export async function removeWebtorrent(magnet: string) {
  const torrent = await client.get(magnet);
  if (torrent) {
    torrent.pause();
    for (const file of torrent.files) {
      const fullPath = path.join(torrent.path, file.path);
      console.debug('deleteing', fullPath);
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        console.debug('deleted', fullPath);
      }
    }
    torrent.destroy();
  }
}

export async function logsWebtorrent(magnet: string) {
  console.debug(`请求日志 for magnet: ${magnet}`);
  return null;
}

const dlcIndexPath = path.join(
  appPath,
  'external-resources',
  'dlc',
  'dlc-index.json',
);
let currentDLCIndex: DLCIndex = [];
/** 读取DLC索引文件 */
export function getDLCIndex(): DLCIndex {
  try {
    if (existsSync(dlcIndexPath)) {
      const configString = readFileSync(dlcIndexPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as DLCIndex;
      currentDLCIndex = config;
    }
    for (const dlc of currentDLCIndex) {
      for (const v in dlc.versions) {
        const version = dlc.versions[v];
        const progress = getProgress(version.magnet);
        version.progress = progress;
      }
    }
    return currentDLCIndex;
  } catch (error) {
    console.error('读取DLC索引失败:', error);
    return [];
  }
}

export function getDLCFromDLCIndex(id: DLCId): OneDLCInfo {
  const dlcIndex = getDLCIndex();
  const num = dlcIndex.findIndex((dlc) => dlc.id === id);
  if (num >= 0) {
    return dlcIndex[num];
  } else {
    throw new Error(`找不到${id}的信息`);
  }
}

export function getLatestVersion(id: DLCId): {
  version: string;
  dlcInfo: OneDLCInfo['versions'][string];
} {
  const dlc = getDLCFromDLCIndex(id);
  const versions = Object.keys(dlc.versions);

  if (versions.length === 0) {
    throw new Error(`DLC ${id} 没有可用的版本`);
  }

  // 找到最新的版本
  let latestVersion = versions[0];
  for (let i = 1; i < versions.length; i++) {
    if (compare(versions[i], latestVersion) > 0) {
      latestVersion = versions[i];
    }
  }

  return {
    version: latestVersion,
    dlcInfo: dlc.versions[latestVersion],
  };
}

export function isLatestVersion(id: DLCId, version: string): boolean {
  const dlc = getDLCFromDLCIndex(id);
  const versions = Object.keys(dlc.versions);

  if (versions.length === 0) {
    return false;
  }

  // 找到最新的版本
  const latestVersion = getLatestVersion(id).version;

  // 比较给定的版本是否等于最新版本
  return compare(version, latestVersion) === 0;
}

export function getIndexVersionByMegnet(magnet: string) {
  const dLCIndex = getDLCIndex();
  for (const dlc of dLCIndex) {
    for (const v in dlc.versions) {
      const version = dlc.versions[v];
      if (version.magnet === magnet) {
        return {
          dlc,
          version: v,
        };
      }
    }
  }
}

/** 检查infoHash是否在DLC索引中列出 */
export function isInfoHashInIndex(infoHash: string): boolean {
  const dLCIndex = getDLCIndex();
  for (const dlc of dLCIndex) {
    for (const v in dlc.versions) {
      const version = dlc.versions[v];
      if (version.magnet) {
        // 从magnet链接中提取infoHash
        try {
          const url = new URL(version.magnet);
          const xt = url.searchParams.get('xt');
          if (xt) {
            const magnetInfoHash = xt.split(':')?.pop();
            if (
              magnetInfoHash &&
              magnetInfoHash.toLowerCase() === infoHash.toLowerCase()
            ) {
              return true;
            }
          }
        } catch (error) {
          console.error('解析magnet链接失败:', version.magnet, error);
        }
      }
    }
  }
  return false;
}

function getProgress(magnet?: string) {
  if (!magnet) {
    return null;
  }
  const params = new URL(magnet).searchParams;
  const xt = params.get('xt');
  const torrent = client.torrents.filter((torrent) => {
    const hash = xt.split(':')?.pop();
    // console.debug('hash', hash, 'infohash', torrent.infoHash);
    return torrent.infoHash === hash;
  })[0];

  if (torrent) {
    const result = shallowCopyPrimitives(torrent);
    // @ts-ignore
    result.progress = torrent.progress;
    // @ts-ignore
    result.ratio = torrent.ratio;
    // @ts-ignore
    result.uploadSpeed = torrent.uploadSpeed;
    // @ts-ignore
    result.downloadSpeed = torrent.downloadSpeed;
    return result;
  }
  return null;
}

function shallowCopyPrimitives<T extends object>(obj: T): T {
  const result = {} as T;
  if (!obj) {
    return obj;
  }
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      // 只复制字符串、数字、boolean类型
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        result[key] = value;
      }
    }
  }
  return result;
}

export async function waitTorrentDone(id: DLCId, version: string) {
  // 根据 id 和 version 获取 DLC 信息
  const dlc = getDLCFromDLCIndex(id);
  const versionInfo = dlc.versions[version];

  if (!versionInfo) {
    throw new Error(`找不到 DLC ${id} 版本 ${version} 的信息`);
  }

  const magnet = versionInfo.magnet;
  if (!magnet) {
    throw new Error(`DLC ${id} 版本 ${version} 没有 magnet 链接`);
  }

  // 从 magnet 链接中提取 infoHash
  const url = new URL(magnet);
  const xt = url.searchParams.get('xt');
  if (!xt) {
    throw new Error(`无效的 magnet 链接: ${magnet}`);
  }

  const infoHash = xt.split(':')?.pop();
  if (!infoHash) {
    throw new Error(`无法从 magnet 链接中提取 infoHash: ${magnet}`);
  }

  // 查找对应的种子
  const torrent = client.torrents.find((t) => t.infoHash === infoHash);

  if (!torrent) {
    throw new Error(`找不到对应的种子，infoHash: ${infoHash}`);
  }

  // 如果已经完成，直接返回
  if (torrent.progress === 1) {
    console.debug(`种子 ${torrent.name} 已经完成下载`);
    return torrent;
  }

  // 轮询检查种子是否完成
  return new Promise<WebTorrent.Torrent>((resolve, reject) => {
    const checkInterval = 1000; // 1秒检查一次
    const maxAttempts = 3600; // 最多检查1小时（3600秒）
    let attempts = 0;

    const intervalId = setInterval(() => {
      attempts++;

      // 检查种子是否仍然存在
      const currentTorrent = client.torrents.find(
        (t) => t.infoHash === infoHash,
      );
      if (!currentTorrent) {
        clearInterval(intervalId);
        reject(new Error(`种子 ${infoHash} 在轮询过程中被移除`));
        return;
      }

      // 检查是否完成
      if (currentTorrent.progress === 1) {
        clearInterval(intervalId);
        console.debug(`种子 ${currentTorrent.name} 下载完成`);
        resolve(currentTorrent);
        return;
      }

      // 检查是否超时
      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        reject(new Error(`等待种子下载超时（${maxAttempts}秒）`));
        return;
      }

      // 输出进度信息（可选，每10秒输出一次）
      if (attempts % 10 === 0) {
        console.debug(
          `种子 ${currentTorrent.name} 下载进度: ${(currentTorrent.progress * 100).toFixed(2)}%`,
        );
      }
    }, checkInterval);

    // 同时监听种子的事件
    torrent.on('done', () => {
      clearInterval(intervalId);
      console.debug(`种子 ${torrent.name} 下载完成（通过事件监听）`);
      resolve(torrent);
    });

    torrent.on('error', (err) => {
      clearInterval(intervalId);
      const errorMessage = typeof err === 'string' ? err : err.message;
      reject(new Error(`种子下载出错: ${errorMessage}`));
    });
  });
}

/** 从文件恢复种子 */
async function restoreTorrentsFromFiles() {
  if (!client) {
    console.warn('WebTorrent客户端未初始化，无法恢复种子');
    return;
  }

  const dlcBasePath = path.join(appPath, 'external-resources', 'dlc');

  // 检查DLC基础目录是否存在
  if (!existsSync(dlcBasePath)) {
    console.debug('DLC目录不存在，无需恢复种子');
    return;
  }

  try {
    // 获取所有DLC文件夹
    const dlcFolders = fs
      .readdirSync(dlcBasePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() && dirent.name !== '.git')
      .map((dirent) => dirent.name);

    let restoredCount = 0;

    for (const dlcId of dlcFolders) {
      const dlcPath = path.join(dlcBasePath, dlcId);

      // 获取所有版本文件夹
      const versionFolders = fs
        .readdirSync(dlcPath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      for (const version of versionFolders) {
        const versionPath = path.join(dlcPath, version);

        // 查找所有.torrent文件
        const files = fs.readdirSync(versionPath);
        const torrentFiles = files.filter((file) => file.endsWith('.torrent'));

        for (const torrentFile of torrentFiles) {
          const torrentPath = path.join(versionPath, torrentFile);
          const infoHash = torrentFile.replace('.torrent', '');

          // 检查是否已经添加了这个种子
          const existingTorrent = client.torrents.find(
            (t) => t.infoHash === infoHash,
          );
          if (existingTorrent) {
            console.debug(`种子 ${infoHash} 已经存在，跳过`);
            continue;
          }

          // 检查种子是否在dlc-index.json中列出，避免用户攻击性行为
          if (!isInfoHashInIndex(infoHash)) {
            console.warn(
              `种子 ${infoHash} 不在dlc-index.json中列出，跳过恢复（可能为攻击性行为）`,
            );
            continue;
          }

          // 检查是否有实际文件存在
          // 我们需要检查除了.torrent文件之外的其他文件
          const otherFiles = files.filter(
            (file) => file !== torrentFile && !file.endsWith('.torrent'),
          );
          if (otherFiles.length === 0) {
            console.debug(
              `版本 ${dlcId}/${version} 没有实际文件，跳过种子 ${infoHash}`,
            );
            continue;
          }

          try {
            // 读取.torrent文件
            const torrentBuffer = fs.readFileSync(torrentPath);

            // 添加种子到WebTorrent
            client.add(torrentBuffer, { path: versionPath }, (torrent) => {
              console.debug(
                `恢复种子成功: ${torrent.name} (${torrent.infoHash})`,
              );
              console.debug(`存储路径: ${torrent.path}`);

              // 根据用户要求，恢复种子后让下载处于暂停状态
              console.debug(`恢复种子后暂停下载: ${torrent.name}`);
              torrent.pause();

              // 如果文件已经完整，切换到做种模式
              if (torrent.progress === 1) {
                console.debug(`文件已完整，切换到做种模式: ${torrent.name}`);
                torrent.deselect(0, torrent.pieces.length - 1, 0);
              }
            });

            restoredCount++;
          } catch (error) {
            console.error(`恢复种子失败 ${torrentPath}:`, error);
          }
        }
      }
    }

    console.debug(`成功恢复 ${restoredCount} 个种子`);
  } catch (error) {
    console.error('恢复种子过程中发生错误:', error);
  }
}
