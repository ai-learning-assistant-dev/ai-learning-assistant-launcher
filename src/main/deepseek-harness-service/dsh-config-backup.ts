/**
 * dsh 配置文件的「同步前备份」。
 *
 * 同步会改写 `$DSH_HOME/settings.yaml`（模型路由）与 `$DSH_HOME/.credentials.yaml`（API key），
 * 这两个文件都是用户可能手工编辑过的，所以每次写入前先整份复制到
 * `<DSH_HOME>/backups/<YYYYMMDD-HHmmss>/`，让用户随时可以整目录拷回去。
 *
 * 两点刻意的设计：
 * - **内容与最近一次备份完全一致时复用旧目录**，不新建：用户连点几次「同步」不会堆出一串
 *   一模一样的备份目录；
 * - **不自动清理历史备份**：备份是用户的安全网，本模块只负责创建，不负责删除。
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** 备份目录名的格式：`YYYYMMDD-HHmmss`（按字符串排序即按时间排序） */
const BACKUP_DIR_NAME_PATTERN = /^\d{8}-\d{6}$/;

/** 备份目录里的说明文件 */
const MANIFEST_FILE_NAME = 'manifest.json';

/** 写入 manifest 的标记，便于用户（和以后可能的清理逻辑）认出这是启动器创建的备份 */
const BACKUP_ORIGIN = 'ai-learning-assistant-launcher';

export interface DshConfigBackupResult {
  /** 备份目录；没有可备份的源文件时为 null */
  dir: string | null;
  /** 实际备份进去的文件名 */
  files: string[];
  /** 与最近一次备份内容完全一致，复用了已有目录（没有新建） */
  reused: boolean;
  /** 源文件都不存在，本次没有做任何备份 */
  skipped: boolean;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** 把时间格式化成备份目录名 `YYYYMMDD-HHmmss` */
export function backupDirName(now: Date): string {
  return (
    `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}` +
    `-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  );
}

/** 列出已有备份目录，按名字倒序（最新的在前） */
function listBackupDirs(backupRoot: string): string[] {
  if (!existsSync(backupRoot)) {
    return [];
  }
  try {
    return readdirSync(backupRoot)
      .filter((name) => BACKUP_DIR_NAME_PATTERN.test(name))
      .filter((name) => {
        try {
          return statSync(path.join(backupRoot, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** 目录里的文件是否与给定内容逐字节一致 */
function dirMatchesContents(
  dir: string,
  contents: Array<{ name: string; data: Buffer }>,
): boolean {
  try {
    return contents.every(
      (item) =>
        existsSync(path.join(dir, item.name)) &&
        readFileSync(path.join(dir, item.name)).equals(item.data),
    );
  } catch {
    return false;
  }
}

/**
 * 把给定的 dsh 配置文件整份备份到 `backupRoot` 下。
 *
 * @param options.files      要备份的文件绝对路径（不存在会被跳过）
 * @param options.backupRoot 备份根目录（通常是 `$DSH_HOME/backups`）
 * @param options.label      写进 manifest 的说明，例如「同步 WorkBuddy 模型配置」
 * @param options.now        当前时间，便于测试
 */
export function backupDshConfigFiles(options: {
  files: string[];
  backupRoot: string;
  label: string;
  now?: Date;
}): DshConfigBackupResult {
  const { files, backupRoot, label } = options;
  const now = options.now ?? new Date();

  // 只备份真实存在、且是普通文件的
  const sources = files
    .map((file) => ({ path: file, name: path.basename(file) }))
    .filter((item) => {
      try {
        return statSync(item.path).isFile();
      } catch {
        return false;
      }
    });

  if (sources.length === 0) {
    return { dir: null, files: [], reused: false, skipped: true };
  }

  const contents = sources.map((source) => ({
    ...source,
    data: readFileSync(source.path),
  }));

  // 与最近一次备份内容一致就复用，避免重复点击堆出一串相同的备份
  const [latest] = listBackupDirs(backupRoot);
  if (latest) {
    const latestDir = path.join(backupRoot, latest);
    if (dirMatchesContents(latestDir, contents)) {
      return {
        dir: latestDir,
        files: contents.map((item) => item.name),
        reused: true,
        skipped: false,
      };
    }
  }

  // 同一秒内再次备份（内容不同）时加序号，避免覆盖上一次
  let dir = path.join(backupRoot, backupDirName(now));
  for (let n = 2; existsSync(dir); n += 1) {
    dir = path.join(backupRoot, `${backupDirName(now)}-${n}`);
  }
  mkdirSync(dir, { recursive: true });

  for (const item of contents) {
    copyFileSync(item.path, path.join(dir, item.name));
  }

  const manifest = {
    origin: BACKUP_ORIGIN,
    createdAt: now.toISOString(),
    label,
    files: contents.map((item) => ({
      name: item.name,
      bytes: item.data.byteLength,
    })),
  };
  writeFileSync(
    path.join(dir, MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return {
    dir,
    files: contents.map((item) => item.name),
    reused: false,
    skipped: false,
  };
}
