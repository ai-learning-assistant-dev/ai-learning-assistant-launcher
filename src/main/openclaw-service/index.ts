import { BrowserWindow, IpcMain, clipboard } from 'electron';
import { gt, rcompare, satisfies, valid } from 'semver';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import type { CancellationToken } from '@podman-desktop/api';
import {
  queryOpenclawServiceHandle,
  installOpenclawServiceHandle,
  removeOpenclawServiceHandle,
  runOpenclawServiceHandle,
  stopOpenclawServiceHandle,
  openOpenclawWindowHandle,
  copyOpenclawDashboardUrlHandle,
  openclawDashboardUrl,
  OPENCLAW_GATEWAY_PORT,
  OpenclawServiceInfo,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import { Exec } from '../exec';
import { isWindows } from '../exec/util';
import { loggerFactory } from '../terminal-log';
import { getLlmConfig } from '../configs';

const commandLine = new Exec();

// openclaw 官方 engines（建议的 node 版本范围）：Node 24.16+（24.x 内）或 Node 26.1+
// 参考 https://docs.openclaw.ai/install/node
const OPENCLAW_NODE_RANGE = '>=24.16.0 <25 || >=26.1.0';

// npm 淘宝镜像源（全局 registry）
const TAOBAO_NPM_REGISTRY = 'https://registry.npmmirror.com';

// Node 二进制淘宝镜像（nodejs.org/dist 的国内镜像），按顺序逐个尝试；
// 可通过环境变量 OPENCLAW_NODE_MIRROR 覆盖第一个镜像地址
const NODE_MIRROR_BASES = process.env.OPENCLAW_NODE_MIRROR
  ? [process.env.OPENCLAW_NODE_MIRROR]
  : [
      'https://cdn.npmmirror.com/binaries/node',
      'https://npmmirror.com/mirrors/node',
      'https://registry.npmmirror.com/-/binary/node',
    ];

/** node 安装候选版本：version 不带 v 前缀，lts 为 LTS 代号（非 LTS 为 null） */
interface NodeVersionCandidate {
  version: string;
  lts: string | null;
}

/** 在线解析出的可用版本：latestLts 为范围内最新 LTS，newest 为范围内最新版本 */
interface NodeVersionOptions {
  latestLts: NodeVersionCandidate | null;
  newest: NodeVersionCandidate | null;
}

// 在线解析失败时的兜底 Node 版本（按优先级排序：先最新 LTS，再退到更早的 LTS 补丁版本，
// 只有 LTS 全部不可用时才用非 LTS 版本）。正常联网时会在线挑选最新 LTS，这里只是离线兜底。
const FALLBACK_NODE_RELEASES: NodeVersionCandidate[] = [
  { version: '24.21.0', lts: 'Krypton' },
  { version: '24.20.0', lts: 'Krypton' },
  { version: '24.16.0', lts: 'Krypton' }, // openclaw 建议范围里的最低 LTS 版本
  { version: '26.1.0', lts: null }, // 最后兜底：非 LTS，但满足 openclaw 建议范围
];

// Node 官方 Windows 安装包（MSI）的下载缓存目录
const installCacheDir = path.join(homedir(), '.openclaw-install-cache');

// openclaw dashboard 窗口实例
let openclawWindow: BrowserWindow | null = null;

// openclaw 配置文件路径
const openclawConfigPath = path.join(homedir(), '.openclaw', 'openclaw.json');

interface NodeToolchain {
  /** 版本号（不带 v 前缀，例如 24.20.0） */
  version: string;
}

// 去掉版本号前面的 v 前缀（v24.20.0 -> 24.20.0）
function cleanNodeVersion(raw: string): string {
  return (raw || '').trim().replace(/^v/i, '');
}

// 判断版本是否处于 openclaw 建议的 node 版本范围
function isNodeVersionSupported(version: string): boolean {
  const cleaned = cleanNodeVersion(version);
  return !!cleaned && satisfies(cleaned, OPENCLAW_NODE_RANGE);
}

// 构造 node 工具链
function createNodeToolchain(version: string): NodeToolchain {
  return {
    version: cleanNodeVersion(version),
  };
}

/**
 * 统一的抛错函数：一次完成三件事 —— 落盘日志、界面命令行日志、抛出错误。
 * cause 为底层错误（例如 exec/写文件的报错），只用于日志，会拼进同一行。
 */
function throwWithLog(message: string, cause?: unknown): never {
  const detail = cause === undefined ? '' : `（${cause}）`;
  const line = `[OPENCLAW] ${message}${detail}`;
  console.error(line); // 落盘：主进程 console 已接入 electron-log（launcher.log）
  loggerFactory('OPENCLAW').error(line); // 界面：命令行日志（terminal-log 通道）
  throw new Error(message);
}

// 读取 PATH 上 node 的版本号；返回 null 表示没有 node 或执行失败。
// 与 detectSystemNode 不同：这里不判断是否符合 openclaw 建议范围（已装 25.x 这类版本也需要知道）
async function detectNodeVersionOnPath(): Promise<string | null> {
  try {
    const result = await commandLine.exec('node', ['-v'], {
      logger: loggerFactory('OPENCLAW'),
    });
    return cleanNodeVersion(result.stdout) || null;
  } catch (e) {
    console.warn(`执行 node -v 失败:`, e);
    return null;
  }
}

// 检测已安装的 node：要求版本位于 openclaw 建议范围；
async function detectSystemNode(): Promise<NodeToolchain | null> {
  if (!isWindows()) {
    return null;
  }
  const version = await detectNodeVersionOnPath();
  if (!version) {
    return null;
  }
  if (!isNodeVersionSupported(version)) {
    console.warn(
      `[OPENCLAW] node 版本 ${version} 不在 openclaw 建议范围（${OPENCLAW_NODE_RANGE}）内`,
    );
    return null;
  }
  // node 官方发行版自带 npm：直接执行 npm（不传自定义 env，靠 process.env.PATH 解析）
  const toolchain = createNodeToolchain(version);
  try {
    await commandLine.exec('npm', ['--version'], {
      logger: loggerFactory('OPENCLAW'),
    });
  } catch (e) {
    console.warn(`[OPENCLAW] node 下的 npm 不可用:`, e);
    return null;
  }
  console.log(
    `[OPENCLAW] 检测到 node v${version}，满足 openclaw 建议版本，直接复用`,
  );
  return toolchain;
}

// 发起 https GET，自动跟随重定向，返回响应体
function httpsGetBuffer(url: string, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doGet = (target: string, redirectCount: number): void => {
      const request = https.get(
        target,
        { headers: { 'User-Agent': 'ai-learning-assistant-launcher' } },
        (response) => {
          const status = response.statusCode || 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            if (redirectCount >= 5) {
              reject(new Error('重定向次数过多'));
              return;
            }
            doGet(
              new URL(response.headers.location, target).toString(),
              redirectCount + 1,
            );
            return;
          }
          if (status !== 200) {
            response.resume();
            reject(new Error(`HTTP ${status}`));
            return;
          }
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.setTimeout(timeoutMs, () =>
        request.destroy(new Error('请求超时')),
      );
    };
    doGet(url, 0);
  });
}

// 下载文件到本地（支持重定向，失败时清理半成品文件）
async function downloadFile(url: string, destPath: string): Promise<void> {
  const buffer = await httpsGetBuffer(url, 60000);
  mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    writeFileSync(destPath, buffer);
  } catch (e) {
    rmSync(destPath, { force: true });
    throwWithLog(`写入下载文件失败：${destPath}`, e);
  }
}

/**
 * 从 node index.json 里挑出可用版本（只考虑 openclaw 建议范围内的版本）。
 * 按 semver 自行降序排序，不依赖镜像返回的先后顺序：
 * - latestLts：范围内最新的 LTS 版本（例如 24.x LTS 线的最新补丁版本）
 * - newest：范围内最新的版本（可能是 Current 非 LTS，用于避开降级安装）
 */
function pickNodeVersionsFromIndex(
  list: Array<{ version?: string; lts?: string | boolean }>,
): NodeVersionOptions | null {
  const available = list
    .map<NodeVersionCandidate>((entry) => ({
      version: cleanNodeVersion(entry.version || ''),
      lts: typeof entry.lts === 'string' && entry.lts ? entry.lts : null,
    }))
    .filter(
      (item) => !!valid(item.version) && isNodeVersionSupported(item.version),
    )
    .sort((a, b) => rcompare(a.version, b.version));
  if (available.length === 0) {
    return null;
  }
  return {
    latestLts: available.find((item) => item.lts) || null,
    newest: available[0],
  };
}

// 离线兜底版本（在线解析失败时使用）：优先最新 LTS，同时给出范围内最新版本以便避开降级安装
function offlineNodeVersionOptions(): NodeVersionOptions {
  const sorted = [...FALLBACK_NODE_RELEASES].sort((a, b) =>
    rcompare(a.version, b.version),
  );
  return {
    latestLts: sorted.find((item) => item.lts) || null,
    newest: sorted[0] || null,
  };
}

/**
 * 生成按优先级排序的 Node 安装候选版本。
 * Node 官方 MSI 不允许“降级安装”：当机器上已有更高版本的 Node 时，安装包会直接失败
 * （"A later version of Node.js is already installed, setup will now exit"）。
 * 因此这里结合现有 node 的版本调整顺序、剔除必然失败的降级候选：
 * - 没有 node，或现有 node 比 LTS 旧（如 22.x）→ 最新 LTS 优先，其次是更早的 LTS 补丁版本
 * - 现有 node 比最新 LTS 还新（如已装 25.x、26.0.x，而 LTS 是 24.x）→ 改选范围内比它更新的版本（26.x）
 * 返回空数组表示所有候选都比现有 node 旧，只能降级安装（MSI 一定会失败），由调用方报错。
 */
function buildNodeInstallCandidates(
  options: NodeVersionOptions,
  existingVersion: string | null,
): NodeVersionCandidate[] {
  // LTS 候选排在前面、非 LTS 候选排在后面，避免非 LTS 版本插到 LTS 补丁版本前面
  const ltsCandidates = [
    options.latestLts,
    ...FALLBACK_NODE_RELEASES.filter((item) => item.lts),
  ];
  const otherCandidates = [
    options.newest,
    ...FALLBACK_NODE_RELEASES.filter((item) => !item.lts),
  ];
  const pool = [...ltsCandidates, ...otherCandidates]
    .filter((item): item is NodeVersionCandidate => !!item)
    .filter(
      (item, index, list) =>
        list.findIndex((other) => other.version === item.version) === index,
    );
  if (!existingVersion || !valid(existingVersion)) {
    return pool;
  }
  return pool.filter((item) => !gt(existingVersion, item.version));
}

// 从淘宝 node 镜像 index.json 挑选要安装的版本：优先最新 LTS
async function pickNodeVersionToInstall(): Promise<NodeVersionOptions> {
  for (const base of NODE_MIRROR_BASES) {
    try {
      const list = JSON.parse(
        (await httpsGetBuffer(`${base}/index.json`, 15000)).toString('utf-8'),
      ) as Array<{ version?: string; lts?: string | boolean }>;
      if (!Array.isArray(list)) {
        continue;
      }
      const options = pickNodeVersionsFromIndex(list);
      if (options) {
        const { latestLts, newest } = options;
        console.log(
          latestLts
            ? `[OPENCLAW] 范围内最新 LTS：v${latestLts.version}（${latestLts.lts}）；范围内最新版本：v${newest?.version}`
            : `[OPENCLAW] ${OPENCLAW_NODE_RANGE} 范围内没有 LTS 版本，可选最新版本 v${newest?.version}（非 LTS）`,
        );
        return options;
      }
      console.warn(
        `[OPENCLAW] ${base} 的 index.json 中没有满足 ${OPENCLAW_NODE_RANGE} 的版本`,
      );
    } catch (e) {
      console.warn(`从 ${base} 解析 node 版本列表失败:`, e);
    }
  }
  const fallback = offlineNodeVersionOptions();
  console.warn(
    `[OPENCLAW] 在线解析 node 版本失败，使用内置兜底版本：最新 LTS v${fallback.latestLts?.version}、范围内最新版本 v${fallback.newest?.version}`,
  );
  return fallback;
}

// 判断当前进程是否已拥有管理员权限
async function isRunningAsAdmin(): Promise<boolean> {
  try {
    await commandLine.exec('net', ['session']);
    return true;
  } catch (e) {
    return false;
  }
}

// 用 Node 官方 Windows 安装包（MSI）静默安装/覆盖 node；
// 非管理员时通过 sudo-prompt 触发 UAC 提权（msiexec 3010/1641 = 安装成功但需重启，视为成功）
async function silentInstallNodeMsi(msiPath: string): Promise<void> {
  const logger = loggerFactory('OPENCLAW');
  const elevated = await isRunningAsAdmin();
  try {
    if (elevated) {
      await commandLine.exec('msiexec', ['/i', msiPath, '/qn', '/norestart'], {
        logger,
      });
    } else {
      console.log('[OPENCLAW] 需要管理员权限安装 Node，正在请求提权（UAC）...');
      await commandLine.exec(
        'msiexec',
        ['/i', `"${msiPath.replace(/"/g, '')}"`, '/qn', '/norestart'],
        { isAdmin: true, logger },
      );
    }
  } catch (e) {
    const exitCode = (e as { exitCode?: number }).exitCode;
    if (exitCode === 3010 || exitCode === 1641) {
      // 安装成功但提示重启后生效
      return;
    }
    if (exitCode === 1638) {
      throwWithLog(
        '机器上已安装同版本或更高版本的 Node.js，官方安装包不支持降级/重复安装，请先卸载现有 Node.js 后重试',
      );
    }
    if (exitCode === 1603) {
      throwWithLog(
        'Node.js 安装包执行失败（1603）：常见原因是已安装更高版本的 Node.js（官方安装包不允许降级安装）或 node.exe 正在运行被占用。请先卸载现有 Node.js 并关闭正在使用 node 的程序后重试',
      );
    }
    throwWithLog('Node.js 安装包执行失败', e);
  }
}

/**
 * 判断现有的 node 能否确定被 Node 官方安装包覆盖安装。
 * 返回 null 表示可以覆盖安装；返回字符串表示不能确定，字符串是引导用户手动升级的报错信息。
 * 官方 MSI 只会覆盖它自己装的那份 node（默认 C:\Program Files\nodejs，或注册表
 * HKLM/HKCU\SOFTWARE\Node.js 里记录的 InstallPath）；nvm、scoop、手工解压等方式装的 node
 * 无法保证被覆盖，装完 PATH 里可能仍解析到旧版本，所以这时不自动安装，改为让用户手动升级。
 */
async function checkNodeOverwritableByMsi(
  targetVersion: string,
): Promise<string | null> {
  // 当前真正生效的 node.exe：用 node 自己报的 process.execPath，
  // 比 where node 可靠（where 可能返回 node.cmd 垫片或别处的 node）
  let nodePath = '';
  try {
    const { stdout } = await commandLine.exec('node', [
      '-p',
      'process.execPath',
    ]);
    nodePath = (stdout || '').trim().split(/\r?\n/).pop()?.trim() || '';
  } catch (e) {
    // 取不到说明没有可用的 node，直接安装即可
    return null;
  }
  if (!nodePath) {
    return null;
  }

  const upgradeHint = `请手动把 Node 升级到 v${targetVersion}（openclaw 建议版本：${OPENCLAW_NODE_RANGE}）后重试`;

  // nvm 管理的 node：官方 MSI 覆盖的是 C:\Program Files\nodejs 这个软链，会破坏 nvm 环境
  const nvmHome = process.env.NVM_HOME || process.env.NVM_SYMLINK;
  if (nvmHome) {
    return `检测到当前 node 由 nvm 管理（${nodePath}，NVM_HOME=${nvmHome}），官方安装包无法覆盖 nvm 安装的版本。${upgradeHint}，nvm 用户可执行 "nvm install ${targetVersion} && nvm use ${targetVersion}"`;
  }

  // 官方安装包记录的安装目录（没有记录时退化为默认安装目录判断）
  let installerDir = '';
  for (const key of ['HKLM\\SOFTWARE\\Node.js', 'HKCU\\SOFTWARE\\Node.js']) {
    try {
      const { stdout } = await commandLine.exec('reg', [
        'query',
        key,
        '/v',
        'InstallPath',
      ]);
      const matched = (stdout || '')
        .split(/\r?\n/)
        .map((line) => line.match(/REG_SZ\s+(.+)$/i))
        .find((match) => !!match);
      if (matched) {
        installerDir = matched[1].trim().replace(/[\\/]+$/, '');
        break;
      }
    } catch (e) {
      // 这个注册表项不存在：说明不是官方安装包装的，继续看下一个
    }
  }
  const defaultDir = path.join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'nodejs',
  );
  const officialDir = installerDir || defaultDir;
  const nodeDir = path.dirname(nodePath).replace(/[\\/]+$/, '');
  if (nodeDir.toLowerCase() === officialDir.toLowerCase()) {
    return null;
  }

  return `当前 node（${nodePath}）不是 Node 官方安装包安装的（官方安装目录：${officialDir}），自动安装无法确保覆盖它，装完可能仍解析到这个旧版本。${upgradeHint}`;
}

// 从淘宝源下载 Node 官方 Windows 安装包（MSI），静默安装并覆盖用户原来的 node
async function installNodeWithMsi(): Promise<NodeToolchain> {
  if (!isWindows()) {
    throwWithLog('自动安装 Node 目前仅支持 Windows 系统');
  }
  if (!['x64', 'arm64'].includes(process.arch)) {
    throwWithLog(`暂不支持 ${process.arch} 架构的 Node 自动安装`);
  }

  // 已安装的 node 版本（可能不在 openclaw 建议范围内，例如用户装了 25.x）
  const existingVersion = await detectNodeVersionOnPath();
  // 在线解析出的可用版本（范围内最新 LTS + 范围内最新版本）
  const versionOptions = await pickNodeVersionToInstall();
  // 按现有 node 版本生成候选顺序：官方 MSI 不允许降级安装，
  // 已装 25.x 这类“比 LTS 更新”的版本时，改选范围内更新的版本（26.x）
  const candidates = buildNodeInstallCandidates(
    versionOptions,
    existingVersion,
  );
  if (candidates.length === 0) {
    throwWithLog(
      `当前 node v${existingVersion} 比所有可安装的 Node 版本都新，而官方安装包不允许降级安装（openclaw 建议范围：${OPENCLAW_NODE_RANGE}）。请手动安装范围内的版本，或用 nvm 切换到范围内版本后重试`,
    );
  }
  console.log(
    `[OPENCLAW] ${existingVersion ? `当前 node v${existingVersion}，` : ''}安装候选顺序：${candidates
      .map((item) => `v${item.version}${item.lts ? '' : '（非 LTS）'}`)
      .join(' → ')}`,
  );

  // 无法确定官方安装包能覆盖现有 node 时，不做自动安装，直接报错引导用户手动升级
  const blockedReason = await checkNodeOverwritableByMsi(candidates[0].version);
  if (blockedReason) {
    throwWithLog(`已停止自动安装：${blockedReason}`);
  }

  // 1. 从淘宝源下载官方 MSI 安装包
  let msiPath = '';
  for (const candidate of candidates) {
    const fileName = `node-v${candidate.version}-${process.arch}.msi`;
    const destPath = path.join(installCacheDir, fileName);
    if (!candidate.lts) {
      console.warn(
        `[OPENCLAW] 选择非 LTS 版本 Node v${candidate.version}（仍满足 openclaw 建议范围）：${
          existingVersion && gt(candidate.version, existingVersion)
            ? `现有 node v${existingVersion} 比最新 LTS 更新，官方安装包不支持降级安装`
            : '范围内没有可用的 LTS 版本'
        }`,
      );
    }
    for (const base of NODE_MIRROR_BASES) {
      try {
        const url = `${base}/v${candidate.version}/${fileName}`;
        console.log(`[OPENCLAW] 从淘宝源下载 Node 官方安装包：${url}`);
        await downloadFile(url, destPath);
        msiPath = destPath;
        break;
      } catch (e) {
        console.warn(
          `[OPENCLAW] 从 ${base} 下载 Node ${candidate.version} 失败:`,
          e,
        );
      }
    }
    if (msiPath) {
      break;
    }
  }
  if (!msiPath) {
    throwWithLog('从淘宝源下载 Node 官方安装包失败，请检查网络后重试');
  }

  // 2. 静默安装（会覆盖用户原来的 node）
  console.log('[OPENCLAW] 开始静默安装（覆盖）Node ...');
  await silentInstallNodeMsi(msiPath);
  rmSync(installCacheDir, { recursive: true, force: true });

  // 3. 校验安装结果（优先检查默认安装目录）
  const toolchain = await detectSystemNode();
  if (!toolchain) {
    throwWithLog(
      'Node 官方安装包安装后仍不可用，可能安装被取消或需要重启电脑，请重试或手动安装 Node.js',
    );
  }
  console.log(`[OPENCLAW] Node 安装/更新完成，当前版本 v${toolchain.version}`);
  return toolchain;
}

// 把淘宝 npm 源写入用户级 .npmrc（对用户的 npm 全局生效），保留原有配置
function setNpmRegistryTaobaoGlobal(): void {
  const npmrcPath = path.join(homedir(), '.npmrc');
  const lines = existsSync(npmrcPath)
    ? readFileSync(npmrcPath, 'utf-8').split(/\r?\n/)
    : [];
  const output: string[] = [];
  let hasRegistry = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf('=');
    if (
      trimmed &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith(';') &&
      eq > 0 &&
      trimmed.slice(0, eq).trim() === 'registry'
    ) {
      output.push(`registry=${TAOBAO_NPM_REGISTRY}`);
      hasRegistry = true;
      continue;
    }
    output.push(line);
  }
  if (!hasRegistry) {
    output.push(`registry=${TAOBAO_NPM_REGISTRY}`);
  }
  writeFileSync(
    npmrcPath,
    `${output.join('\n').replace(/\n+$/, '')}\n`,
    'utf-8',
  );
  console.log(
    `[OPENCLAW] npm 源已设置为淘宝源（全局生效）：${TAOBAO_NPM_REGISTRY}`,
  );
}

// 检测 pnpm 是否可用：直接执行 pnpm --version，由 PATH 解析命令，不做路径查找
async function isPnpmAvailable(): Promise<boolean> {
  try {
    const { stdout } = await commandLine.exec('pnpm', ['--version'], {
      logger: loggerFactory('OPENCLAW'),
    });
    return !!(stdout || '').trim();
  } catch (e) {
    return false;
  }
}

// 执行全局命令；目标目录（如 Program Files\nodejs）无写权限时自动 UAC 提权重试
// 不传自定义 env：直接使用进程环境（process.env.PATH 已在别处同步为最新）
async function runGlobalMaybeElevated(
  command: string,
  args: string[],
  action = '操作',
): Promise<void> {
  const logger = loggerFactory('OPENCLAW');
  const runElevated = async (): Promise<void> => {
    const quotedArgs = args.map((arg) =>
      arg.includes(' ') ? `"${arg.replace(/"/g, '')}"` : arg,
    );
    await commandLine.exec(command, quotedArgs, {
      isAdmin: true,
      logger,
    });
  };

  const elevated = await isRunningAsAdmin();
  if (elevated) {
    await commandLine.exec(command, args, { logger });
    return;
  }
  try {
    await commandLine.exec(command, args, { logger });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/(EACCES|EPERM|EISDIR|EROFS|EINVAL)/.test(message)) {
      throwWithLog(`${action}失败`, e);
    }
    console.warn(
      `[OPENCLAW] 全局目录无写权限，正在通过管理员权限（UAC）${action}:`,
      e,
    );
    await runElevated();
  }
}

// 确保 pnpm 已全局安装（没有时通过 npm 安装，走淘宝源）
async function ensurePnpmInstalled(): Promise<void> {
  let toolchain = await detectSystemNode();
  let newNode = false;
  if (!toolchain) {
    console.log(
      '[OPENCLAW] 未检测到满足建议版本的 node，准备下载 Node 官方 Windows 安装包并静默安装（会覆盖原 node）',
    );
    toolchain = await installNodeWithMsi();
    newNode = true;
  }
  const available = await isPnpmAvailable();
  if ((!available) || newNode) {
    console.log(
      '[OPENCLAW] 未找到 pnpm，先通过 npm 全局安装 pnpm（淘宝源）...',
    );
    await runGlobalMaybeElevated(
      'npm',
      [
        'install',
        '-g',
        'pnpm@latest',
        '--no-fund',
        '--no-audit',
        '--allow-scripts=pnpm',
        '--registry',
        TAOBAO_NPM_REGISTRY,
      ],
      '安装 pnpm',
    );
    if (!(await isPnpmAvailable())) {
      throwWithLog(
        'pnpm 安装后仍不可用（可能安装失败或 PATH 未刷新），请重新运行安装',
      );
    }
  }
}

// 通过 pnpm 全局安装 openclaw
async function pnpmInstallOpenclaw(): Promise<void> {
  await ensurePnpmInstalled();
  console.log('[OPENCLAW] 开始通过 pnpm 全局安装 openclaw（淘宝源）...');
  await runGlobalMaybeElevated(
    'pnpm',
    [
      'add',
      '-g',
      '--allow-build=openclaw',
      'openclaw@latest',
      '--registry',
      TAOBAO_NPM_REGISTRY,
    ],
    '安装 openclaw',
  );

  try {
    await runOpenclawCli(['-V']);
  } catch (e) {
    throwWithLog('openclaw pnpm 全局安装失败，请检查网络后重试', e);
  }
}

// 通过 pnpm 全局卸载 openclaw
async function pnpmRemoveOpenclaw(): Promise<void> {
  await ensurePnpmInstalled();
  await runGlobalMaybeElevated(
    'pnpm',
    ['remove', '-g', 'openclaw'],
    '卸载 openclaw',
  );
}

// 通过 node 运行 openclaw CLI
async function runOpenclawCli(
  args: string[],
  token?: CancellationToken,
): Promise<string> {
  const toolchain = await detectSystemNode();
  if (!toolchain) {
    throwWithLog(
      `未找到满足 OpenClaw 建议版本的 Node.js（建议版本：${OPENCLAW_NODE_RANGE}）`,
    );
  }
  const { stdout } = await commandLine.exec('openclaw', args, {
    logger: loggerFactory('OPENCLAW'),
    token,
  });
  return stdout;
}

// 读取网关共享密钥（优先环境变量，其次配置文件）
function getOpenclawGatewayToken(): string {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    return process.env.OPENCLAW_GATEWAY_TOKEN;
  }
  try {
    const config = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'));
    const token = config?.gateway?.auth?.token;
    return typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

// 构造带密钥的 dashboard 链接（密钥通过 URL fragment 传递，避免进入请求日志）
function getOpenclawDashboardUrl(): string {
  const token = getOpenclawGatewayToken();
  if (token) {
    return `${openclawDashboardUrl}#token=${encodeURIComponent(token)}`;
  }
  return openclawDashboardUrl;
}

// 探测网关指定路径，确认 HTTP 200 且（可选）满足就绪 JSON 契约
function probeGateway(pathname: string, expectReady = false): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${OPENCLAW_GATEWAY_PORT}${pathname}`,
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }
          if (!expectReady) {
            resolve(true);
            return;
          }
          try {
            resolve(JSON.parse(body).ready === true);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 检查网关是否存活（/healthz 存活探针）
async function checkGatewayRunning(): Promise<boolean> {
  return probeGateway('/healthz');
}

// 等待网关完全就绪，最多等待 timeoutMs 毫秒
async function waitGatewayRunning(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeGateway('/readyz', true)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

// 打开 openclaw dashboard 窗口（仅创建窗口，不管理网关生命周期）
function createOpenclawWindow(): void {
  if (openclawWindow && !openclawWindow.isDestroyed()) {
    if (openclawWindow.isMinimized()) {
      openclawWindow.restore();
    }
    openclawWindow.focus();
    return;
  }

  openclawWindow = new BrowserWindow({
    height: 900,
    width: 1400,
    autoHideMenuBar: true,
  });

  openclawWindow.loadURL(getOpenclawDashboardUrl());

  openclawWindow.on('closed', () => {
    openclawWindow = null;
  });
}

export default async function init(ipcMain: IpcMain) {
  ipcHandle(ipcMain, queryOpenclawServiceHandle, async (_event) =>
    queryOpenclawService(),
  );
  ipcHandle(ipcMain, installOpenclawServiceHandle, async (_event) =>
    installOpenclawService(),
  );
  ipcHandle(ipcMain, removeOpenclawServiceHandle, async (_event) =>
    removeOpenclawService(),
  );
  ipcHandle(ipcMain, runOpenclawServiceHandle, async (_event) =>
    runOpenclawService(),
  );
  ipcHandle(ipcMain, stopOpenclawServiceHandle, async (_event) =>
    stopOpenclawService(),
  );
  ipcHandle(ipcMain, openOpenclawWindowHandle, async (_event) =>
    openOpenclawWindow(),
  );
  ipcHandle(ipcMain, copyOpenclawDashboardUrlHandle, async (_event) =>
    copyOpenclawDashboardUrl(),
  );
}

// 使用本项目的大模型配置对 openclaw 做非交互式 onboarding
async function onboardOpenclaw(): Promise<void> {
  const model = getLlmConfig().models.find((m) => !m.isEmbeddingModel);
  if (!model) {
    throwWithLog('未配置大模型，请先在设置中配置大模型');
  }

  const args = [
    'onboard',
    '--non-interactive',
    '--accept-risk',
    '--skip-health',
    '--auth-choice',
    'custom-api-key',
    '--custom-base-url',
    model.baseUrl,
    '--custom-model-id',
    model.name,
    '--install-daemon',
  ];

  if (model.apiKey) {
    args.push('--custom-api-key', model.apiKey);
  }

  // anthropic 模型使用 anthropic 兼容格式，其余默认 openai 兼容
  if (model.provider.toLowerCase() === 'anthropic') {
    args.push('--custom-compatibility', 'anthropic');
  }

  await runOpenclawCli(args);
}

export async function queryOpenclawService(): Promise<OpenclawServiceInfo> {
  const running = await checkGatewayRunning();
  try {
    const toolchain = await detectSystemNode();
    if (toolchain) {
      const version = await runOpenclawCli(['-V']);
      if (version) {
        return { state: 'installed', version: version || '', running };
      }
    }
  } catch (e) {
    console.warn('查询 openclaw 服务失败:', e);
  }
  return { state: 'not_install', running };
}

export async function installOpenclawService(): Promise<OpenclawServiceInfo> {
  // 若网关正在运行，先停止，避免 node.exe 被占用导致官方安装包覆盖失败
  try {
    if (await checkGatewayRunning()) {
      await stopOpenclawService();
    }
  } catch (e) {
    console.warn('停止 openclaw 网关失败（可忽略）:', e);
  }

  // 4. 设置 npm 源为淘宝源（写入用户级 .npmrc，全局生效）
  setNpmRegistryTaobaoGlobal();

  // 5. 使用 pnpm 全局安装 openclaw
  console.log('[OPENCLAW] 开始通过 pnpm 全局安装 openclaw（淘宝源）...');
  await pnpmInstallOpenclaw();

  // 6. 使用项目内读取的大模型配置初始化 openclaw
  console.log('[OPENCLAW] 使用项目大模型配置初始化 openclaw ...');
  await onboardOpenclaw();

  // 7. 自动启动网关并打开 gateway 网页
  console.log('[OPENCLAW] 自动打开 gateway 网页 ...');
  if (!(await checkGatewayRunning())) {
    try {
      await runOpenclawCli(['gateway', 'start']);
    } catch (e) {
      console.warn('[OPENCLAW] 启动网关失败，尝试重新安装网关服务后启动:', e);
      await runOpenclawCli(['gateway', 'install', '--runtime', 'node']);
      await runOpenclawCli(['gateway', 'start']);
    }
    await waitGatewayRunning();
  }
  createOpenclawWindow();

  return queryOpenclawService();
}

export async function removeOpenclawService(): Promise<OpenclawServiceInfo> {
  // 卸载前先停止网关并关闭窗口
  await stopOpenclawService();
  try {
    await runOpenclawCli(['gateway', 'uninstall']);
  } catch (e) {
    console.warn('卸载 openclaw 网关服务失败（可忽略）:', e);
  }
  const toolchain = await detectSystemNode();
  if (toolchain) {
    try {
      await pnpmRemoveOpenclaw();
    } catch (e) {
      console.warn('卸载 openclaw pnpm 包失败:', e);
    }
  }
  return queryOpenclawService();
}

export async function runOpenclawService(): Promise<OpenclawServiceInfo> {
  const toolchain = await detectSystemNode();
  if (!toolchain) {
    throwWithLog('未找到可用的 Node.js，请先安装 OpenClaw');
  }
  const info = await queryOpenclawService();
  if (info.state !== 'installed') {
    throwWithLog('OpenClaw 未安装，请先安装');
  }

  // 网关未运行时先启动（后台常驻）
  if (!(await checkGatewayRunning())) {
    try {
      await runOpenclawCli(['gateway', 'start']);
    } catch (e) {
      console.warn('[OPENCLAW] 启动网关失败，尝试重新安装网关服务后启动:', e);
      await runOpenclawCli(['gateway', 'install', '--runtime', 'node']);
      await runOpenclawCli(['gateway', 'start']);
    }
    await waitGatewayRunning();
  }

  createOpenclawWindow();

  return queryOpenclawService();
}

// 打开 openclaw dashboard 界面窗口（不自动运行网关）
export async function openOpenclawWindow(): Promise<OpenclawServiceInfo> {
  createOpenclawWindow();

  return queryOpenclawService();
}

// 复制带密钥的 dashboard 页面链接到剪贴板，方便用其他浏览器打开 Control UI
export async function copyOpenclawDashboardUrl(): Promise<string> {
  const url = getOpenclawDashboardUrl();
  clipboard.writeText(url);
  return url;
}

export async function stopOpenclawService(): Promise<OpenclawServiceInfo> {
  // 关闭 dashboard 窗口
  if (openclawWindow && !openclawWindow.isDestroyed()) {
    openclawWindow.close();
  }
  openclawWindow = null;

  try {
    await runOpenclawCli(['gateway', 'stop', '--force']);
  } catch (e) {
    console.warn('停止 openclaw 网关失败:', e);
  }

  return queryOpenclawService();
}
