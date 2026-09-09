import { BrowserWindow, IpcMain, clipboard } from 'electron';
import { satisfies } from 'semver';
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

// 在线解析失败时的兜底 Node 版本（均满足 openclaw 建议范围）
const FALLBACK_NODE_VERSIONS = ['24.20.0', '26.1.0'];

// Node 官方 Windows 安装包（MSI）的下载缓存目录
const installCacheDir = path.join(homedir(), '.openclaw-install-cache');

// Node 官方 Windows 安装包的默认安装目录（Program Files\nodejs）
function getDefaultNodeInstallDir(): string {
  return path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs');
}

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

// 通过 where 查找 PATH 上的第一个可执行文件
async function findFirstOnPath(command: string): Promise<string | null> {
  try {
    const { stdout } = await commandLine.exec('where', [command]);
    const line = (stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    return line || null;
  } catch (e) {
    console.warn(`查找 ${command} 失败:`, e);
    return null;
  }
}

// 展开 %VAR% 环境变量占位符（Windows 注册表里保存的是 REG_EXPAND_SZ）
function expandEnvVars(value: string): string {
  const envMap: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    const val = process.env[key];
    if (typeof val === 'string') {
      envMap[key.toLowerCase()] = val;
    }
  }
  let result = value;
  for (let i = 0; i < 8; i++) {
    const before = result;
    result = result.replace(/%([^%]+)%/g, (_match, name: string) => {
      const found = envMap[String(name).toLowerCase()];
      return found !== undefined ? found : `%${name}%`;
    });
    if (result === before) {
      break;
    }
  }
  return result;
}

// 从注册表读取一条 PATH（用户：HKCU\Environment，系统：HKLM\...\Environment）
async function readRegistryPath(regKeyPath: string): Promise<string> {
  try {
    const { stdout } = await commandLine.exec('reg', [
      'query',
      regKeyPath,
      '/v',
      'PATH',
    ]);
    const line = (stdout || '')
      .split(/\r?\n/)
      .find((l) => /REG_(EXPAND_)?SZ/.test(l));
    if (!line) {
      return '';
    }
    const typeMatch = line.match(/REG_(EXPAND_)?SZ/);
    if (!typeMatch) {
      return '';
    }
    return expandEnvVars(
      line.slice((typeMatch.index || 0) + typeMatch[0].length).trim(),
    );
  } catch (e) {
    return '';
  }
}

// 读取注册表中最新的“系统 PATH + 用户 PATH”（已安装 pnpm 后新开的 cmd 能生效，
// 但当前 Electron 进程的 process.env.PATH 还是启动时的旧快照，因此需要这里补充）
async function getLatestSystemPath(): Promise<string> {
  const userPath = await readRegistryPath('HKCU\\Environment');
  const machinePath = await readRegistryPath(
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  );
  return [machinePath, userPath].filter(Boolean).join(';');
}

// 把“nodeDir → 注册表最新(系统+用户) PATH → 当前 process PATH”合并写回 process.env.PATH
// （进程级生效，后续 commandLine.exec 无需再传自定义 env，即可解析到与 cmd 一致的最新 npm/pnpm）
async function syncProcessEnvPath(nodeDir: string): Promise<void> {
  const latestPath = await getLatestSystemPath();
  const merged = [nodeDir, latestPath, process.env.PATH || '']
    .filter(Boolean)
    .join(';');
  const parts: string[] = [];
  for (const raw of merged.split(';')) {
    const part = raw.trim();
    if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) {
      parts.push(part);
    }
  }
  process.env.PATH = parts.join(';');
}

// 检测已安装的 node：要求版本位于 openclaw 建议范围；
async function detectSystemNode(): Promise<NodeToolchain | null> {
  if (!isWindows()) {
    return null;
  }
  let version = '';
  try {
    const result = await commandLine.exec('node', ['-v'], {
      logger: loggerFactory('OPENCLAW'),
    });
    version = cleanNodeVersion(result.stdout);
  } catch (e) {
    console.warn(`执行 node -v 失败:`, e);
    return null;
  }
  if (!isNodeVersionSupported(version)) {
    console.warn(
      `[OPENCLAW] node 版本 ${version} 不在 openclaw 建议范围（${OPENCLAW_NODE_RANGE}）内`,
    );
    return null
  }
  // node 官方发行版自带 npm：直接执行 npm（不传自定义 env，靠 process.env.PATH 解析）
  const toolchain = createNodeToolchain(version);
  try {
    const npmCheck = await commandLine.exec('npm', ['--version'], {
      logger: loggerFactory('OPENCLAW'),
    });
    if (!(npmCheck.stdout || '').trim()) {
    }
  } catch (e) {
    console.warn(`[OPENCLAW] node 下的 npm 不可用:`, e);
    return null
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
    throw e;
  }
}

// 从淘宝 node 镜像 index.json 挑选最新的、位于 openclaw 建议范围内的 LTS 版本
async function pickNodeVersionToInstall(): Promise<string> {
  for (const base of NODE_MIRROR_BASES) {
    try {
      const list = JSON.parse(
        (await httpsGetBuffer(`${base}/index.json`, 15000)).toString('utf-8'),
      ) as Array<{ version?: string; lts?: string | boolean }>;
      if (!Array.isArray(list)) {
        continue;
      }
      for (const entry of list) {
        const version = cleanNodeVersion(entry.version || '');
        if (version && isNodeVersionSupported(version) && entry.lts) {
          return version;
        }
      }
      for (const entry of list) {
        const version = cleanNodeVersion(entry.version || '');
        if (version && isNodeVersionSupported(version)) {
          return version;
        }
      }
    } catch (e) {
      console.warn(`从 ${base} 解析 node 版本列表失败:`, e);
    }
  }
  console.warn(
    `[OPENCLAW] 解析 node 最新版本失败，使用兜底版本 ${FALLBACK_NODE_VERSIONS[0]}`,
  );
  return FALLBACK_NODE_VERSIONS[0];
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
// 非管理员时通过 sudo-prompt 触发 UAC 提权（msiexec 3010 = 安装成功但需重启，视为成功）
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
    if (exitCode === 3010) {
      // 安装成功但提示重启后生效
      return;
    }
    throw e;
  }
}

// 从淘宝源下载 Node 官方 Windows 安装包（MSI），静默安装并覆盖用户原来的 node
async function installNodeWithMsi(): Promise<NodeToolchain> {
  if (!isWindows()) {
    throw new Error('自动安装 Node 目前仅支持 Windows 系统');
  }
  if (!['x64', 'arm64'].includes(process.arch)) {
    throw new Error(`暂不支持 ${process.arch} 架构的 Node 自动安装`);
  }

  // 依次尝试的版本：在线解析出的最新版本优先，失败后回退到内置兜底版本
  const preferredVersion = await pickNodeVersionToInstall();
  const candidates = [
    preferredVersion,
    ...FALLBACK_NODE_VERSIONS.filter((v) => v !== preferredVersion),
  ];

  // 1. 从淘宝源下载官方 MSI 安装包
  let msiPath = '';
  for (const candidate of candidates) {
    const fileName = `node-v${candidate}-${process.arch}.msi`;
    const destPath = path.join(installCacheDir, fileName);
    for (const base of NODE_MIRROR_BASES) {
      try {
        const url = `${base}/v${candidate}/${fileName}`;
        console.log(`[OPENCLAW] 从淘宝源下载 Node 官方安装包：${url}`);
        await downloadFile(url, destPath);
        msiPath = destPath;
        break;
      } catch (e) {
        console.warn(`[OPENCLAW] 从 ${base} 下载 Node ${candidate} 失败:`, e);
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
  console.log('[OPENCLAW] 开始静默安装（覆盖）Node ...');
  await silentInstallNodeMsi(msiPath);
  rmSync(installCacheDir, { recursive: true, force: true });

  // 3. 校验安装结果（优先检查默认安装目录）
  const toolchain = await detectSystemNode();
  if (!toolchain) {
    throw new Error(
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

// 直接执行 pnpm 命令（pnpm 由 PATH 解析，无需查找安装路径）
async function runPnpm(
  _toolchain: NodeToolchain,
  args: string[],
  logger = loggerFactory('OPENCLAW'),
): Promise<string> {
  const { stdout } = await commandLine.exec('pnpm', args, {
    logger,
  });
  return stdout;
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
      throw e;
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
  if (!toolchain) {
    console.log(
      '[OPENCLAW] 未检测到满足建议版本的 node，准备下载 Node 官方 Windows 安装包并静默安装（会覆盖原 node）',
    );
    toolchain = await installNodeWithMsi();
  }
  const available = await isPnpmAvailable();
  if (!available) {
    console.log(
      '[OPENCLAW] 未找到 pnpm，先通过 npm 全局安装 pnpm（淘宝源）...',
    );
    await runGlobalMaybeElevated(
      'npm',
      [
        'install',
        '-g',
        'pnpm',
        '--no-fund',
        '--no-audit',
        '--allow-scripts=pnpm',
        '--registry',
        TAOBAO_NPM_REGISTRY,
      ],
      '安装 pnpm',
    );
    if (!(await isPnpmAvailable())) {
      throw new Error(
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
    throw new Error('openclaw pnpm 全局安装失败，请检查网络后重试');
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
  let toolchain = await detectSystemNode();
  if (!toolchain) {
    throw new Error(
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
    throw new Error('未配置大模型，请先在设置中配置大模型');
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
    throw new Error('未找到可用的 Node.js，请先安装 OpenClaw');
  }
  const info = await queryOpenclawService();
  if (info.state !== 'installed') {
    throw new Error('OpenClaw 未安装，请先安装');
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
