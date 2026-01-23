import { Button, Input } from 'antd';
import { useEffect, useState } from 'react';
import { DLCIndex } from '../../../main/dlc/type-info';

function getState(version: DLCIndex[0]['versions'][string]) {
  if (version.progress) {
    if (version.progress.done) {
      if (version.progress.paused) {
        return '已暂停做种';
      } else {
        return '做种中';
      }
    } else {
      if (version.progress.paused) {
        return '已暂停下载';
      } else {
        return '下载中';
      }
    }
  } else {
    return '未开始';
  }
}

export default function P2PTest() {
  const [dLCIndex, setDLCIndex] = useState<DLCIndex>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(1);
  useEffect(() => {
    window.mainHandle
      .queryWebtorrentHandle()
      .then((newDLCIndex) => setDLCIndex(newDLCIndex));
    const timeout = setTimeout(
      () => setRefreshTrigger(refreshTrigger + 1),
      1000,
    );
    return () => {
      clearTimeout(timeout);
    };
  }, [refreshTrigger, setRefreshTrigger]);
  return (
    <table>
      <tbody>
        {dLCIndex.flatMap((dlc) => {
          const versions = [];
          for (const key in dlc.versions) {
            const version = dlc.versions[key];
            versions.push(
              <tr>
                <td>
                  {dlc.name}
                  {key}
                </td>
                <td>
                  <textarea value={JSON.stringify(version.progress, null, 2)} />
                </td>
                <td>{getState(version)}</td>
                <td>
                  {(getState(version) === '未开始' ||
                    getState(version) === '已暂停下载' ||
                    getState(version) === '已暂停做种') && (
                    <Button
                      onClick={() =>
                        window.mainHandle.startWebtorrentHandle(
                          dlc.versions[key].magnet,
                        )
                      }
                    >
                      {getState(version) === '已暂停做种'
                        ? '开始做种'
                        : '开始下载'}
                    </Button>
                  )}
                  {(getState(version) === '做种中' ||
                    getState(version) === '下载中') && (
                    <Button
                      onClick={() =>
                        window.mainHandle.pauseWebtorrentHandle(
                          dlc.versions[key].magnet,
                        )
                      }
                    >
                      {getState(version) === '做种中' ? '停止做种' : '停止下载'}
                    </Button>
                  )}
                  {getState(version) !== '未开始' && (
                    <Button
                      onClick={() =>
                        window.mainHandle.removeWebtorrentHandle(
                          dlc.versions[key].magnet,
                        )
                      }
                    >
                      删除文件
                    </Button>
                  )}
                </td>
              </tr>,
            );
          }
          return versions;
        })}
      </tbody>
    </table>
  );
}
