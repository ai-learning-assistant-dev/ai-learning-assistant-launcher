import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { gt, rcompare, satisfies, valid } from 'semver';
import type { Logger } from '@podman-desktop/api';
import { Exec } from '../exec';
import { isWindows } from '../exec/util';

/**
 * 依赖 Node 的原生服务（openclaw-service / deepseek-harness-service）共用的
 * Node 工具链：检测 PATH 上的 node、必要时用 Node 官方 Windows 安装包（MSI）
 * 静默覆盖安装、安装后刷新 process.env.PATH、以及 npm/pnpm 全局安装命令的
 * UAC 提权兜底。
 *
 * 之所以抽成独立模块：这些逻辑踩过的坑（MSI 不允许降级安装、Electron 主进程
 * 的 PATH 快照过期、全局 bin 目录不在 PATH 里、sudo-prompt 不接受含特殊字符
 * 的环境变量名）与具体服务无关，复制一份就等于把这些坑再踩一遍。
 */

/** npm 淘宝镜像源（全局 registry） */
export const TAOBAO_NPM_REGISTRY = 'https://registry.npmmirror.com';

// Node 二进制淘宝镜像（nodejs.org/dist 的国内镜像），按顺序逐个尝试；
// 可通过环境变量 NODE_MIRROR 覆盖第一个镜像地址
const NODE_MIRROR_BASES = process.env.NODE_MIRROR
  ? [process.env.NODE_MIRROR]
  : [
      'https://cdn.npmmirror.com/binaries/node',
      'https://npmmirror.com/mirrors/node',
      'https://registry.npmmirror.com/-/binary/node',
    ];

/** node 安装候选版本：version 不带 v 前缀，lts 为 LTS 代号（非 LTS 为 null） */
export interface NodeVersionCandidate {
  version: string;
  lts: string | null;
}

/** 在线解析出的可用版本：latestLts 为范围内最新 LTS，newest 为范围内最新版本 */
export interface NodeVersionOptions {
  latestLts: NodeVersionCandidate | null;
  newest: NodeVersionCandidate | null;
}

/** 单个服务自己的 Node 版本策略 */
export interface NodeVersionPolicy {
  /** 支持的版本范围（semver range） */
  range: string;
  /** 服务名，用于日志与报错文案 */
  label: string;
  /** 离线兜底版本（按优先级排序：先最新 LTS，再退到更早的 LTS 补丁版本） */
  fallbackReleases: NodeVersionCandidate[];
}

// Node 官方 Windows 安装包（MSI）的下载缓存目录
const installCacheDir = path.join(homedir(), '.node-install-cache');

// 去掉版本号前面的 v 前缀（v24.20.0 -> 24.20.0）
export function cleanNodeVersion(raw: string): string {
  return (raw || '').trim().replace(/^v/i, '');
}

// 判断版本是否处于目标服务支持的 node 版本范围
export function isNodeVersionSupported(
  version: string,
  policy: NodeVersionPolicy,
): boolean {
  const cleaned = cleanNodeVersion(version);
  return !!cleaned && satisfies(cleaned, policy.range);
}

// 读取 PATH 上 node 的版本号；返回 null 表示没有 node 或执行失败。
// 与 detectSystemNode 不同：这里不判断是否符合服务的版本范围（已装 25.x 这类
// 版本也需要知道，用于避开降级安装）
export async function detectNodeVersionOnPath(
  exec: Exec,
  logger?: Logger,
): Promise<string | null> {
  try {
    const result = await exec.exec('node', ['-v'], { logger });
    return cleanNodeVersion(result.stdout) || null;
  } catch (e) {
    console.warn('执行 node -v 失败:', e);
    return null;
  }
}

/**
 * 检测已安装的 node：要求版本位于服务支持的范围内，且 node 自带 npm 可用。
 * 返回 null 表示不可用（未安装 / 版本不符 / npm 不可用）。
 */
export async function detectSystemNode(
  exec: Exec,
  policy: NodeVersionPolicy,
): Promise<string | null> {
  if (!isWindows()) {
    return null;
  }
  const version = await detectNodeVersionOnPath(exec);
  if (!version) {
    return null;
  }
  if (!isNodeVersionSupported(version, policy)) {
    console.warn(
      `[${policy.label}] node 版本 ${version} 不在建议范围（${policy.range}）内`,
    );
    return null;
  }
  try {
    await exec.exec('npm', ['--version']);
  } catch (e) {
    console.warn(`[${policy.label}] node 下的 npm 不可用:`, e);
    return null;
  }
  console.log(
    `[${policy.label}] 检测到 node v${version}，满足建议版本，直接复用`,
  );
  return version;
}

// ===== 安装 node / npm / pnpm 后刷新 PATH 环境变量 =====
//
// Electron 主进程启动时，process.env.PATH 只是当时的快照。安装 node（MSI）、通过
// npm 全局安装包时，都会往系统/用户环境变量里写入新的可执行目录，但当前进程拿不到
// 这些更新，导致后续 node / npm / 全局命令在 PATH 上找不到（典型表现：Node 官方
// 安装包装完后 detectSystemNode 仍失败）。

// 展开 Windows 路径里的 %VAR%（如 %APPDATA%\npm），查不到时原样保留
function expandWindowsEnvVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    const direct = process.env[name];
    if (direct !== undefined) {
      return direct;
    }
    const key = Object.keys(process.env).find(
      (k) => k.toLowerCase() === name.toLowerCase(),
    );
    return key ? (process.env[key] ?? match) : match;
  });
}

// 读取 Windows 注册表里的系统 PATH + 用户 PATH（Windows 生效 PATH = 系统 PATH + 用户 PATH）
async function readWindowsPathFromRegistry(exec: Exec): Promise<string> {
  const segments: string[] = [];
  for (const key of [
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    'HKCU\\Environment',
  ]) {
    try {
      const { stdout } = await exec.exec('reg', ['query', key, '/v', 'Path']);
      // reg query 输出形如：
      //   Path    REG_SZ    C:\Windows\system32;C:\Program Files\nodejs
      //   Path    REG_EXPAND_SZ    C:\Windows\system32;%APPDATA%\npm
      const matched = (stdout || '')
        .split(/\r?\n/)
        .map((line) => line.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/i))
        .find((m) => !!m);
      if (matched) {
        segments.push(matched[1].trim());
      }
    } catch {
      // 该项不存在（例如没有用户级 PATH），跳过
    }
  }
  return expandWindowsEnvVars(segments.join(';'));
}

// 把目录前置到 process.env.PATH（展开 %VAR%、去重、保留原有内容）
function prependToProcessPath(...dirs: Array<string | null | undefined>): void {
  const clean = dirs
    .filter((dir): dir is string => !!dir)
    .map((dir) =>
      expandWindowsEnvVars(dir)
        .trim()
        .replace(/[\\/]+$/, ''),
    )
    .filter(Boolean);
  if (clean.length === 0) {
    return;
  }
  const current = (process.env.PATH || '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set(current.map((p) => p.toLowerCase()));
  const added: string[] = [];
  for (const dir of clean) {
    if (!seen.has(dir.toLowerCase())) {
      seen.add(dir.toLowerCase());
      added.push(dir);
    }
  }
  if (added.length === 0) {
    return;
  }
  process.env.PATH = [...added, ...current].join(';');
  console.log(`[node-toolchain] 已把以下目录前置到 PATH：${added.join('; ')}`);
}

// npm 的全局 bin 目录（Windows 上全局包的 .cmd 直接放在 npm prefix 目录里）
async function resolveNpmGlobalBinDir(exec: Exec): Promise<string> {
  try {
    const { stdout } = await exec.exec('npm', ['prefix', '-g']);
    return (stdout || '').trim().split(/\r?\n/).pop()?.trim() || '';
  } catch {
    return '';
  }
}

// pnpm 的全局 bin 目录（pnpm add -g 后全局命令所在位置；pnpm v7+ 支持 bin -g）
async function resolvePnpmGlobalBinDir(exec: Exec): Promise<string> {
  try {
    const { stdout } = await exec.exec('pnpm', ['bin', '-g']);
    return (stdout || '').trim().split(/\r?\n/).pop()?.trim() || '';
  } catch {
    return '';
  }
}

// 安装步骤完成后统一刷新 PATH：先读注册表最新值，再补上 npm / pnpm 全局 bin 目录
export async function refreshPathAfterInstall(exec: Exec): Promise<void> {
  if (!isWindows()) {
    return;
  }
  const registryPath = await readWindowsPathFromRegistry(exec);
  if (registryPath) {
    process.env.PATH = registryPath;
    console.log('[node-toolchain] 已从注册表刷新 process.env.PATH');
  }
  // 显式补充常见的 npm / pnpm 全局 bin 目录，防止注册表 PATH 里没有（例如 pnpm
  // 通过 npm 安装且未执行 pnpm setup 时，pnpm 的 bin 目录不在 PATH 里）
  prependToProcessPath(
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'nodejs')
      : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
    process.env.PNPM_HOME,
    process.env.PNPM_HOME ? path.join(process.env.PNPM_HOME, 'bin') : null,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'pnpm', 'bin')
      : null,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'pnpm')
      : null,
  );
  // 用 npm / pnpm 自己的答案修正（最准确，覆盖按默认规则猜不到的目录）
  const npmBin = await resolveNpmGlobalBinDir(exec);
  if (npmBin) {
    prependToProcessPath(npmBin);
  }
  const pnpmBin = await resolvePnpmGlobalBinDir(exec);
  if (pnpmBin) {
    prependToProcessPath(pnpmBin);
  }
}

// ===== 安装 node =====

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
    throw new Error(`写入下载文件失败：${destPath}（${e}）`);
  }
}

/**
 * 从 node index.json 里挑出可用版本（只考虑目标服务支持范围内的版本）。
 * 按 semver 自行降序排序，不依赖镜像返回的先后顺序：
 * - latestLts：范围内最新的 LTS 版本
 * - newest：范围内最新的版本（可能是 Current 非 LTS，用于避开降级安装）
 */
export function pickNodeVersionsFromIndex(
  list: Array<{ version?: string; lts?: string | boolean }>,
  policy: NodeVersionPolicy,
): NodeVersionOptions | null {
  const available = list
    .map<NodeVersionCandidate>((entry) => ({
      version: cleanNodeVersion(entry.version || ''),
      lts: typeof entry.lts === 'string' && entry.lts ? entry.lts : null,
    }))
    .filter(
      (item) =>
        !!valid(item.version) && isNodeVersionSupported(item.version, policy),
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
function offlineNodeVersionOptions(
  policy: NodeVersionPolicy,
): NodeVersionOptions {
  const sorted = [...policy.fallbackReleases].sort((a, b) =>
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
 * 因此这里结合现有 node 的版本调整顺序、剔除必然失败的降级候选。
 * 返回空数组表示所有候选都比现有 node 旧，只能降级安装（MSI 一定会失败），由调用方报错。
 */
export function buildNodeInstallCandidates(
  options: NodeVersionOptions,
  policy: NodeVersionPolicy,
  existingVersion: string | null,
): NodeVersionCandidate[] {
  // LTS 候选排在前面、非 LTS 候选排在后面，避免非 LTS 版本插到 LTS 补丁版本前面
  const ltsCandidates = [
    options.latestLts,
    ...policy.fallbackReleases.filter((item) => item.lts),
  ];
  const otherCandidates = [
    options.newest,
    ...policy.fallbackReleases.filter((item) => !item.lts),
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
async function pickNodeVersionToInstall(
  policy: NodeVersionPolicy,
): Promise<NodeVersionOptions> {
  for (const base of NODE_MIRROR_BASES) {
    try {
      const list = JSON.parse(
        (await httpsGetBuffer(`${base}/index.json`, 15000)).toString('utf-8'),
      ) as Array<{ version?: string; lts?: string | boolean }>;
      if (!Array.isArray(list)) {
        continue;
      }
      const options = pickNodeVersionsFromIndex(list, policy);
      if (options) {
        const { latestLts, newest } = options;
        console.log(
          latestLts
            ? `[${policy.label}] 范围内最新 LTS：v${latestLts.version}（${latestLts.lts}）；范围内最新版本：v${newest?.version}`
            : `[${policy.label}] ${policy.range} 范围内没有 LTS 版本，可选最新版本 v${newest?.version}（非 LTS）`,
        );
        return options;
      }
      console.warn(
        `[${policy.label}] ${base} 的 index.json 中没有满足 ${policy.range} 的版本`,
      );
    } catch (e) {
      console.warn(`从 ${base} 解析 node 版本列表失败:`, e);
    }
  }
  const fallback = offlineNodeVersionOptions(policy);
  console.warn(
    `[${policy.label}] 在线解析 node 版本失败，使用内置兜底版本：最新 LTS v${fallback.latestLts?.version}、范围内最新版本 v${fallback.newest?.version}`,
  );
  return fallback;
}

// 判断当前进程是否已拥有管理员权限
async function isRunningAsAdmin(exec: Exec): Promise<boolean> {
  try {
    await exec.exec('net', ['session']);
    return true;
  } catch (e) {
    return false;
  }
}

// 用 Node 官方 Windows 安装包（MSI）静默安装/覆盖 node；
// 非管理员时通过 sudo-prompt 触发 UAC 提权（msiexec 3010/1641 = 安装成功但需重启，视为成功）
async function silentInstallNodeMsi(
  exec: Exec,
  msiPath: string,
  label: string,
): Promise<void> {
  const elevated = await isRunningAsAdmin(exec);
  try {
    if (elevated) {
      await exec.exec('msiexec', ['/i', msiPath, '/qn', '/norestart']);
    } else {
      console.log(`[${label}] 需要管理员权限安装 Node，正在请求提权（UAC）...`);
      await exec.exec(
        'msiexec',
        ['/i', `"${msiPath.replace(/"/g, '')}"`, '/qn', '/norestart'],
        { isAdmin: true },
      );
    }
  } catch (e) {
    const exitCode = (e as { exitCode?: number }).exitCode;
    if (exitCode === 3010 || exitCode === 1641) {
      // 安装成功但提示重启后生效
      return;
    }
    if (exitCode === 1638) {
      throw new Error(
        '机器上已安装同版本或更高版本的 Node.js，官方安装包不支持降级/重复安装，请先卸载现有 Node.js 后重试',
      );
    }
    if (exitCode === 1603) {
      throw new Error(
        'Node.js 安装包执行失败（1603）：常见原因是已安装更高版本的 Node.js（官方安装包不允许降级安装）或 node.exe 正在运行被占用。请先卸载现有 Node.js 并关闭正在使用 node 的程序后重试',
      );
    }
    throw new Error(`Node.js 安装包执行失败（${e}）`);
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
  exec: Exec,
  policy: NodeVersionPolicy,
  targetVersion: string,
): Promise<string | null> {
  // 当前真正生效的 node.exe：用 node 自己报的 process.execPath，
  // 比 where node 可靠（where 可能返回 node.cmd 垫片或别处的 node）
  let nodePath = '';
  try {
    const { stdout } = await exec.exec('node', ['-p', 'process.execPath']);
    nodePath = (stdout || '').trim().split(/\r?\n/).pop()?.trim() || '';
  } catch (e) {
    // 取不到说明没有可用的 node，直接安装即可
    return null;
  }
  if (!nodePath) {
    return null;
  }

  const upgradeHint = `请手动把 Node 升级到 v${targetVersion}（${policy.label} 建议版本：${policy.range}）后重试`;

  // nvm 管理的 node：官方 MSI 覆盖的是 C:\Program Files\nodejs 这个软链，会破坏 nvm 环境
  const nvmHome = process.env.NVM_HOME || process.env.NVM_SYMLINK;
  if (nvmHome) {
    return `检测到当前 node 由 nvm 管理（${nodePath}，NVM_HOME=${nvmHome}），官方安装包无法覆盖 nvm 安装的版本。${upgradeHint}，nvm 用户可执行 "nvm install ${targetVersion} && nvm use ${targetVersion}"`;
  }

  // 官方安装包记录的安装目录（没有记录时退化为默认安装目录判断）
  let installerDir = '';
  for (const key of ['HKLM\\SOFTWARE\\Node.js', 'HKCU\\SOFTWARE\\Node.js']) {
    try {
      const { stdout } = await exec.exec('reg', [
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

/**
 * 从淘宝源下载 Node 官方 Windows 安装包（MSI），静默安装并覆盖用户原来的 node。
 * existingVersion 为当前 PATH 上的 node 版本（用于避开官方 MSI 不允许的降级安装）。
 */
export async function installNodeWithMsi(
  exec: Exec,
  policy: NodeVersionPolicy,
  existingVersion: string | null,
): Promise<string> {
  if (!isWindows()) {
    throw new Error('自动安装 Node 目前仅支持 Windows 系统');
  }
  if (!['x64', 'arm64'].includes(process.arch)) {
    throw new Error(`暂不支持 ${process.arch} 架构的 Node 自动安装`);
  }

  // 在线解析出的可用版本（范围内最新 LTS + 范围内最新版本）
  const versionOptions = await pickNodeVersionToInstall(policy);
  // 按现有 node 版本生成候选顺序：官方 MSI 不允许降级安装，
  // 已装 25.x 这类“比 LTS 更新”的版本时，改选范围内更新的版本
  const candidates = buildNodeInstallCandidates(
    versionOptions,
    policy,
    existingVersion,
  );
  if (candidates.length === 0) {
    throw new Error(
      `当前 node v${existingVersion} 比所有可安装的 Node 版本都新，而官方安装包不允许降级安装（${policy.label} 建议范围：${policy.range}）。请手动安装范围内的版本，或用 nvm 切换到范围内版本后重试`,
    );
  }
  console.log(
    `[${policy.label}] ${existingVersion ? `当前 node v${existingVersion}，` : ''}安装候选顺序：${candidates
      .map((item) => `v${item.version}${item.lts ? '' : '（非 LTS）'}`)
      .join(' → ')}`,
  );

  // 无法确定官方安装包能覆盖现有 node 时，不做自动安装，直接报错引导用户手动升级
  const blockedReason = await checkNodeOverwritableByMsi(
    exec,
    policy,
    candidates[0].version,
  );
  if (blockedReason) {
    throw new Error(`已停止自动安装：${blockedReason}`);
  }

  // 1. 从淘宝源下载官方 MSI 安装包
  let msiPath = '';
  for (const candidate of candidates) {
    const fileName = `node-v${candidate.version}-${process.arch}.msi`;
    const destPath = path.join(installCacheDir, fileName);
    if (!candidate.lts) {
      console.warn(
        `[${policy.label}] 选择非 LTS 版本 Node v${candidate.version}（仍满足建议范围）：${
          existingVersion && gt(candidate.version, existingVersion)
            ? `现有 node v${existingVersion} 比最新 LTS 更新，官方安装包不支持降级安装`
            : '范围内没有可用的 LTS 版本'
        }`,
      );
    }
    for (const base of NODE_MIRROR_BASES) {
      try {
        const url = `${base}/v${candidate.version}/${fileName}`;
        console.log(`[${policy.label}] 从淘宝源下载 Node 官方安装包：${url}`);
        await downloadFile(url, destPath);
        msiPath = destPath;
        break;
      } catch (e) {
        console.warn(
          `[${policy.label}] 从 ${base} 下载 Node ${candidate.version} 失败:`,
          e,
        );
      }
    }
    if (msiPath) {
      break;
    }
  }
  if (!msiPath) {
    throw new Error('从淘宝源下载 Node 官方安装包失败，请检查网络后重试');
  }

  // 2. 静默安装（会覆盖用户原来的 node）
  console.log(`[${policy.label}] 开始静默安装（覆盖）Node ...`);
  await silentInstallNodeMsi(exec, msiPath, policy.label);
  rmSync(installCacheDir, { recursive: true, force: true });

  // 3. 安装后刷新 PATH：MSI 已把 node 目录写入系统/用户 PATH，但当前进程拿到的
  // process.env.PATH 仍是启动时的旧快照，不刷新就无法执行 node -v
  await refreshPathAfterInstall(exec);

  // 4. 校验安装结果
  const version = await detectSystemNode(exec, policy);
  if (!version) {
    throw new Error(
      'Node 官方安装包安装后仍不可用，可能安装被取消或需要重启电脑，请重试或手动安装 Node.js',
    );
  }
  console.log(`[${policy.label}] Node 安装/更新完成，当前版本 v${version}`);
  return version;
}

/**
 * 确保 PATH 上有满足 range 的 node，没有就自动安装。
 * 返回可用的 node 版本号。
 */
export async function ensureNode(
  exec: Exec,
  policy: NodeVersionPolicy,
): Promise<string> {
  // 先刷新 PATH：进程启动时拿到的 process.env.PATH 是旧快照，用户可能在此期间
  // 手动装过 node，先同步到最新再检测，避免误判“未安装”
  await refreshPathAfterInstall(exec);
  const existing = await detectSystemNode(exec, policy);
  if (existing) {
    return existing;
  }
  const onPath = await detectNodeVersionOnPath(exec);
  console.log(
    `[${policy.label}] 未检测到满足建议版本（${policy.range}）的 node${
      onPath ? `（当前 v${onPath}）` : ''
    }，准备下载 Node 官方 Windows 安装包并静默安装（会覆盖原 node）`,
  );
  return installNodeWithMsi(exec, policy, onPath);
}

// ===== pnpm =====

/** 检测 pnpm 是否可用：直接执行 pnpm --version，由 PATH 解析命令，不做路径查找 */
export async function isPnpmAvailable(exec: Exec): Promise<boolean> {
  try {
    const { stdout } = await exec.exec('pnpm', ['--version']);
    return !!(stdout || '').trim();
  } catch (e) {
    return false;
  }
}

/**
 * 确保 pnpm 已全局安装：没有时通过 npm 全局安装（淘宝源），装完刷新 PATH 并复检。
 * 调用方需要保证 node/npm 可用（可先调 ensureNode）。
 */
export async function ensurePnpmInstalled(
  exec: Exec,
  label: string,
  logger?: Logger,
): Promise<boolean> {
  if (await isPnpmAvailable(exec)) {
    return false;
  }
  console.log(`[${label}] 未找到 pnpm，先通过 npm 全局安装 pnpm（淘宝源）...`);
  await runGlobalMaybeElevated(
    exec,
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
    logger,
    '安装 pnpm',
  );
  // 安装后刷新 PATH：npm 全局安装会把 pnpm 写进 npm 的全局 bin 目录，
  // 需要让当前进程能解析到 pnpm 命令
  await refreshPathAfterInstall(exec);
  if (!(await isPnpmAvailable(exec))) {
    throw new Error(
      'pnpm 安装后仍不可用（可能安装失败或 PATH 未刷新），请重新运行安装',
    );
  }
  console.log(`[${label}] pnpm 安装完成`);
  return true;
}

// ===== 全局安装 =====

// 把淘宝 npm 源写入用户级 .npmrc（对用户的 npm 全局生效），保留原有配置
export function setNpmRegistryTaobaoGlobal(): void {
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
    `[node-toolchain] npm 源已设置为淘宝源（全局生效）：${TAOBAO_NPM_REGISTRY}`,
  );
}

/**
 * 执行全局 npm 命令；目标目录（如 Program Files\nodejs）无写权限时自动 UAC 提权重试。
 * 不传自定义 env：直接使用进程环境（process.env.PATH 已由 refreshPathAfterInstall 同步为最新）。
 */
export async function runGlobalMaybeElevated(
  exec: Exec,
  command: string,
  args: string[],
  logger?: Logger,
  action = '操作',
): Promise<void> {
  const runElevated = async (): Promise<void> => {
    const quotedArgs = args.map((arg) =>
      arg.includes(' ') ? `"${arg.replace(/"/g, '')}"` : arg,
    );
    await exec.exec(command, quotedArgs, { isAdmin: true, logger });
  };

  if (await isRunningAsAdmin(exec)) {
    await exec.exec(command, args, { logger });
    return;
  }
  try {
    await exec.exec(command, args, { logger });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/(EACCES|EPERM|EISDIR|EROFS|EINVAL)/.test(message)) {
      throw new Error(`${action}失败（${e}）`);
    }
    console.warn(
      `[node-toolchain] 全局目录无写权限，正在通过管理员权限（UAC）${action}:`,
      e,
    );
    await runElevated();
  }
}
