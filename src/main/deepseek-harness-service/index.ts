import {
  app,
  BrowserWindow,
  IpcMain,
  clipboard,
  session,
  shell,
} from 'electron';
import { createHash, createHmac } from 'node:crypto';
import {
  createWriteStream,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import type { ChildProcess } from 'node:child_process';
import { load } from 'js-yaml';
import {
  queryDeepseekHarnessServiceHandle,
  installDeepseekHarnessServiceHandle,
  removeDeepseekHarnessServiceHandle,
  runDeepseekHarnessServiceHandle,
  stopDeepseekHarnessServiceHandle,
  openDeepseekHarnessWindowHandle,
  copyDeepseekHarnessDashboardUrlHandle,
  syncWorkbuddyModelsToDshHandle,
  openDeepseekHarnessBackupDirHandle,
  deepseekHarnessDashboardUrl,
  DEEPSEEK_HARNESS_NPM_PACKAGE,
  DEEPSEEK_HARNESS_NODE_RANGE,
  DEEPSEEK_HARNESS_PORTS,
  DeepseekHarnessServiceInfo,
  WorkbuddyModelSyncResult,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import { Exec } from '../exec';
import { loggerFactory } from '../terminal-log';
import { getLlmConfig } from '../configs';
import { spawn } from 'cross-spawn';
import {
  TAOBAO_NPM_REGISTRY,
  detectSystemNode,
  ensureNode,
  ensurePnpmInstalled,
  refreshPathAfterInstall,
  runGlobalMaybeElevated,
  setNpmRegistryTaobaoGlobal,
  type NodeVersionPolicy,
} from '../node-toolchain';
import type { SyncLogger } from './dsh-config-providers';
import {
  createDshSyncLogger,
  dshBackupRoot,
  dshCredentialsPath,
  dshProfilePatchPath,
  syncModelsIntoDshHarness,
  syncWorkbuddyModelsIntoDshHarness,
} from './dsh-model-sync';

/**
 * DeepSeek Harness（dsh）服务：
 * - dsh 是全局安装的 npm 包（`npm i -g @deepseek-ai/dsh`），所以已安装时直接复用，不重复安装
 * - 界面是 `dsh web`（默认端口 3080），启动时打印带一次性 token 的 URL；机器上已有实例时
 *   直接复用该实例，不再另起一个
 * - 安装时把本项目配置的大模型镜像进 dsh 的 profile 补丁（`$DSH_HOME/profiles/web/cordis.patch.yml`）：
 *   DeepSeek 官方提供方写 `llm-deepseek`（内置路由 `deepseek-official`），其余模型写 `llm-pi-ai`
 *   的自定义提供方路由；非空 API key 写进 `$DSH_HOME/.credentials.yaml`（空 / 全空白密钥不写），
 *   装完即可在 dsh 的模型选择器里选到。DeepSeek 密钥同时写进联网搜索提供方
 *   `web-search-deepseek`（复用同一把 key，非 DeepSeek 密钥不写）
 */

const DS_LABEL = 'DEEPSEEK_HARNESS';

const commandLine = new Exec();

// dsh 的 Node 版本策略：dsh 的会话持久化用到 Node 24 才有的 zlib zstd API，
// 而包本身没有声明 engines 字段，低版本 Node 只会在运行时抛晦涩的 SyntaxError
const DSH_NODE_POLICY: NodeVersionPolicy = {
  label: DS_LABEL,
  range: DEEPSEEK_HARNESS_NODE_RANGE,
  // 在线解析失败时的兜底版本（Node 24 的 LTS 补丁版本）
  fallbackReleases: [
    { version: '24.21.0', lts: 'Krypton' },
    { version: '24.20.0', lts: 'Krypton' },
    { version: '24.16.0', lts: 'Krypton' },
  ],
};

/** 就绪等待上限：超过这个时间端口仍未就绪（根路径回 401）就放弃，不再打开界面 */
const READY_TIMEOUT_MS = 2 * 60 * 1000;

/** 启动硬超时兜底：超过这个时间整个启动流程仍未结束就报错（正常应在 READY_TIMEOUT_MS 内结束） */
const STARTUP_TIMEOUT_MS = 150000;

/** 由本模块拉起的 dsh web 子进程（已有的外部实例不在这里） */
let dshProcess: ChildProcess | null = null;

/** 最近一次探测到的 dsh web 端口与带 token 的界面地址 */
let activePort: number | null = null;
let activeUrl: string | null = null;

/** dashboard 界面窗口实例 */
let dshWindow: BrowserWindow | null = null;

/**
 * 统一日志入口：同一条日志同时写 console（主进程 console 已接入 electron-log，落盘 launcher.log）
 * 和界面命令行日志（terminal-log 通道）。本文件所有日志都应走这里，不要直接 console.log/warn/error。
 */
const logger = {
  log(message: string, ...rest: unknown[]): void {
    console.log(message, ...rest);
    loggerFactory(DS_LABEL).log(
      rest.length === 0 ? message : `${message} ${rest.map(String).join(' ')}`,
    );
  },
  warn(message: string, ...rest: unknown[]): void {
    console.warn(message, ...rest);
    loggerFactory(DS_LABEL).warn(
      rest.length === 0 ? message : `${message} ${rest.map(String).join(' ')}`,
    );
  },
  error(message: string, ...rest: unknown[]): void {
    console.error(message, ...rest);
    loggerFactory(DS_LABEL).error(
      rest.length === 0 ? message : `${message} ${rest.map(String).join(' ')}`,
    );
  },
};

/**
 * 统一的抛错函数：一次完成三件事 —— 落盘日志、界面命令行日志、抛出错误。
 * cause 为底层错误（例如 exec/写文件的报错），只用于日志，会拼进同一行。
 */
function throwWithLog(message: string, cause?: unknown): never {
  const detail = cause === undefined ? '' : `（${cause}）`;
  const line = `[${DS_LABEL}] ${message}${detail}`;
  logger.error(line);
  throw new Error(message);
}

// ===== dsh 安装目录与配置文件 =====
//
// 路径解析（`$DSH_HOME` / profiles/web/cordis.patch.yml / .credentials.yaml）与配置同步都在
// dsh-model-sync.ts 里，安装流程与模型配置页的「同步 API key」按钮共用同一套。

// ===== 运行状态探测 =====

/**
 * 探测单个端口上是否有 dsh web 进程在监听（不区分是否就绪）。
 * “能收到 HTTP 响应”就说明端口上有服务在跑，不必也不应该去校验响应码。
 * 就绪判定请用 {@link probePortReady}。
 */
function probePort(port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 探测端口上的 dsh web 是否「真正就绪」（不是仅仅端口已监听）。
 * 就绪判据：根路径 `/` 返回 401。dsh web 未带 cookie 访问时会回鉴权挑战（401），
 * 而启动流程中路由尚未注册完时根路径会回 404、端口未绑定时会 ECONNREFUSED。
 * 因此只有 401 才代表 dsh 已完成启动、可以打开界面；404 说明还在启动、界面还没就绪。
 */
function probePortReady(port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      res.resume();
      resolve(res.statusCode === 401);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** 按候选端口顺序探测：返回第一个存活的端口，都没有则返回 null */
async function detectRunningPort(): Promise<number | null> {
  // 并发探测（回环地址上无监听会立刻 ECONNREFUSED，只有异常情况才会等超时），
  // 结果按候选顺序取第一个存活的
  const results = await Promise.all(
    DEEPSEEK_HARNESS_PORTS.map((port) => probePort(port)),
  );
  const index = results.findIndex((alive) => alive);
  return index < 0 ? null : DEEPSEEK_HARNESS_PORTS[index];
}

/**
 * 按端口号反查正在监听的进程 pid。
 * Electron 主进程重启后，之前 `spawn` 出来的 dsh web 子进程句柄就丢了
 * （`dshProcess` 为 null），此时只能靠端口号把那个进程找回来。
 * netstat 在 Windows 上始终可用（wmic 在新系统上已被移除），格式为：
 *   TCP    127.0.0.1:3080    0.0.0.0:0    LISTENING    12672
 */
async function findListenerPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await commandLine.exec('netstat', ['-ano']);
    const pattern = new RegExp(
      `^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`,
    );
    for (const line of (stdout || '').split(/\r?\n/)) {
      const matched = pattern.exec(line);
      if (matched) {
        return Number(matched[1]);
      }
    }
    return null;
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 查询端口 ${port} 的监听进程失败:`, e);
    return null;
  }
}

/** 等端口不再响应（进程结束后端口会被释放） */
async function waitPortStopped(
  port: number,
  timeoutMs = 10000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probePort(port, 1500))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * 结束占用指定端口的 dsh web 进程（按端口号反查 pid）。
 * 先 taskkill 连子进程一起结束；仍有残留时退回 PowerShell 强杀；
 * 最后用端口探测确认真的停下来了。返回是否已停止。
 */
async function killDshByPort(port: number): Promise<boolean> {
  const pid = await findListenerPid(port);
  if (pid === null) {
    const stopped = !(await probePort(port, 1000));
    if (stopped) {
      logger.log(`[${DS_LABEL}] 端口 ${port} 上没有监听进程，无需结束`);
    } else {
      logger.warn(
        `[${DS_LABEL}] 端口 ${port} 仍在响应，但没能从 netstat 里找到监听进程`,
      );
    }
    return stopped;
  }

  logger.log(
    `[${DS_LABEL}] 按端口 ${port} 找到 dsh web 进程（pid ${pid}），准备结束`,
  );
  try {
    await commandLine.exec('taskkill', ['/pid', String(pid), '/T', '/F']);
  } catch (e) {
    logger.warn(
      `[${DS_LABEL}] taskkill 结束 pid ${pid} 失败，改用 PowerShell 强杀:`,
      e,
    );
    try {
      await commandLine.exec('powershell', [
        '-NoProfile',
        '-Command',
        `Stop-Process -Id ${pid} -Force`,
      ]);
    } catch (e2) {
      logger.warn(`[${DS_LABEL}] 强行结束 pid ${pid} 失败:`, e2);
    }
  }

  if (await waitPortStopped(port)) {
    cachedAccess = null;
    logger.log(`[${DS_LABEL}] 端口 ${port} 上的 dsh web 已停止`);
    return true;
  }
  logger.warn(`[${DS_LABEL}] 端口 ${port} 仍在响应，dsh web 未能停止`);
  return false;
}

/** 读取全局安装的 dsh CLI 版本；null 表示未安装或版本不符合要求 */
async function detectDshInstalled(): Promise<string | null> {
  const nodeVersion = await detectSystemNode(commandLine, DSH_NODE_POLICY);
  if (!nodeVersion) {
    return null;
  }
  try {
    const { stdout } = await commandLine.exec('dsh', ['--version'], {
      logger: loggerFactory(DS_LABEL),
    });
    return (stdout || '').trim().split(/\r?\n/).pop()?.trim() || null;
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 执行 dsh --version 失败:`, e);
    return null;
  }
}

// ===== 界面地址与浏览器鉴权 =====

/**
 * dsh web 的浏览器鉴权（node_modules/@deepseek-ai/dsh-client-connection）：
 * - 启动时为每个进程随机生成一个 launch token，打印成 `http://host:port/?token=<token>`；
 *   页面用这个 token 换一个**签名 cookie**，之后带着 cookie 访问即可。
 * - cookie 名 = `dsh-auth-<base64url(sha256(authority))>`，authority 就是 Host（如 127.0.0.1:3080）；
 *   cookie 值 = `v1.<base64url(payload)>.<base64url(HMAC-SHA256(secret, body))>`，
 *   payload = `{ version, authority, issuedAt, expiresAt }`。
 * - 签名密钥持久化在 `$DSH_HOME/.credentials.yaml` 的
 *   `client-connection/browser-session` 记录里（kind: grant, payload.secret）。
 *
 * 因此：本模块自己拉起的实例直接用打印出来的带 token 地址；机器上**已有的**实例拿不到
 * 进程内 token，就用本地密钥离线签一个 cookie 塞给窗口（签完先发一次请求校验，401 就退回
 * 普通地址，不假装已登录）。
 */

const DS_AUTH_COOKIE_PREFIX = 'dsh-auth-';
const DS_AUTH_COOKIE_VERSION = 'v1';
const DS_AUTH_PAYLOAD_VERSION = 1;
const DS_AUTH_SECRET_BYTES = 32;

/** 自签 cookie 的有效期（天）：dsh 默认为 30 天，这里取更保守的 7 天 */
const DS_AUTH_COOKIE_DAYS = 7;

/** 本模块管理的界面窗口专用会话分区：cookie 会持久化，重启后仍可复用 */
const DS_WINDOW_PARTITION = 'persist:dsh-web';

function encodeBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return null;
  }
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = Buffer.from(
    value.replace(/-/g, '+').replace(/_/g, '/') + padding,
    'base64',
  );
  return encodeBase64Url(decoded) === value ? decoded : null;
}

/** dsh 的 cookie 名：`dsh-auth-` + base64url(sha256(authority)) */
function dshAuthCookieName(authority: string): string {
  return `${DS_AUTH_COOKIE_PREFIX}${encodeBase64Url(
    createHash('sha256').update(authority).digest(),
  )}`;
}

/**
 * 读取 dsh 浏览器会话的签名密钥。
 * 记录不存在/格式不对时返回 null（此时无法自签 cookie，只能靠带 token 的地址）。
 */
function readDshAuthSecret(): Buffer | null {
  const file = dshCredentialsPath();
  if (!existsSync(file)) {
    return null;
  }
  try {
    const document = load(readFileSync(file, 'utf-8')) as {
      records?: Record<
        string,
        { kind?: string; payload?: { version?: number; secret?: string } }
      >;
    };
    const record = document?.records?.['client-connection/browser-session'];
    if (
      record?.kind !== 'grant' ||
      record.payload?.version !== DS_AUTH_PAYLOAD_VERSION ||
      typeof record.payload.secret !== 'string'
    ) {
      return null;
    }
    const secret = decodeBase64Url(record.payload.secret);
    if (!secret || secret.byteLength !== DS_AUTH_SECRET_BYTES) {
      return null;
    }
    return secret;
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 读取 dsh 浏览器会话密钥失败:`, e);
    return null;
  }
}

/** 按 dsh 的格式签一个浏览器会话 cookie 值 */
function signDshAuthCookie(authority: string, secret: Buffer): string {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + DS_AUTH_COOKIE_DAYS * 24 * 60 * 60 * 1000;
  const body = encodeBase64Url(
    Buffer.from(
      JSON.stringify({
        version: DS_AUTH_PAYLOAD_VERSION,
        authority,
        issuedAt,
        expiresAt,
      }),
      'utf8',
    ),
  );
  const signature = createHmac('sha256', secret).update(body).digest();
  return `${DS_AUTH_COOKIE_VERSION}.${body}.${encodeBase64Url(signature)}`;
}

/**
 * 校验自签 cookie 是否真被这个实例接受。
 * 根路径带合法 cookie 会 303/200，未认证则是 401（dsh 会回
 * “dsh web authentication required; reopen the URL printed by dsh web.”）。
 */
function verifyDshAuthCookie(
  port: number,
  authority: string,
  cookie: string,
  timeoutMs = 3000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        headers: {
          Host: authority,
          Cookie: cookie,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode !== 401);
      },
    );
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** 窗口专用会话（cookie 持久化在用户数据目录里，重启后仍有效） */
function getDshWindowSession(): ReturnType<typeof session.fromPartition> {
  return session.fromPartition(DS_WINDOW_PARTITION);
}

/** 解析出来的界面访问方式：地址 + 让这个地址可用的方式 */
interface DashboardAccess {
  /** 打开的地址（要么是带 token 的地址，要么是普通根地址） */
  url: string;
  /** token 方式：窗口直接加载 url 即已登录 */
  token?: string;
  /** cookie 方式：把这条 `name=value` 写进窗口会话后，url 即已登录 */
  cookie?: { name: string; value: string };
}

/** 缓存的访问方式（按端口缓存，避免每次开窗口都重新签 cookie） */
let cachedAccess: { port: number; access: DashboardAccess } | null = null;

/**
 * 解析怎么免登录打开 `port` 上的 dsh web：
 * 1. 已有带 token 的地址（本模块自己拉起的实例）→ 直接用；
 * 2. 否则（复用机器上已有的实例）→ 用本地密钥签一个 cookie，**先请求校验**，
 *    被这个实例接受才采用；
 * 3. 都不行 → 普通地址，由 dsh 自己回 401 提示。
 */
async function resolveDashboardAccess(
  port: number,
  forceRefresh = false,
): Promise<DashboardAccess> {
  if (!forceRefresh && cachedAccess?.port === port) {
    return cachedAccess.access;
  }

  const plainUrl = deepseekHarnessDashboardUrl(port);
  const access = await (async (): Promise<DashboardAccess> => {
    if (activeUrl) {
      return { url: activeUrl, token: activeUrl };
    }

    const secret = readDshAuthSecret();
    if (!secret) {
      logger.warn(
        `[${DS_LABEL}] 未找到 dsh 浏览器会话密钥，无法自动登录界面（可在 dsh 终端里复制带 token 的地址打开）`,
      );
      return { url: plainUrl };
    }

    const authority = new URL(plainUrl).host;
    const name = dshAuthCookieName(authority);
    const value = signDshAuthCookie(authority, secret);
    const accepted = await verifyDshAuthCookie(
      port,
      authority,
      `${name}=${value}`,
    );
    if (!accepted) {
      // 已有实例的签名密钥通常和本地一致；不一致（例如实例用的是别的 DSH_HOME）
      // 时不能假装已登录，退回普通地址
      logger.warn(
        `[${DS_LABEL}] 自签的 dsh 会话 cookie 未被实例接受（实例的签名密钥不匹配），改用普通地址打开`,
      );
      return { url: plainUrl };
    }
    return { url: plainUrl, cookie: { name, value } };
  })();

  cachedAccess = { port, access };
  return access;
}

/** 把解析出的 cookie 写进窗口会话；返回是否写成功 */
async function applyDashboardCookie(access: DashboardAccess): Promise<boolean> {
  if (!access.cookie) {
    return true;
  }
  try {
    await getDshWindowSession().cookies.set({
      url: access.url,
      name: access.cookie.name,
      value: access.cookie.value,
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
    });
    logger.log(`[${DS_LABEL}] 已为界面窗口写入 dsh 会话 cookie`);
    return true;
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 写入 dsh 会话 cookie 失败:`, e);
    return false;
  }
}

/**
 * 复制给外部浏览器用的地址。
 * 带 token 的地址可以直接复制；靠 cookie 登录的实例没有可复制的 token，
 * 此时复制普通地址并提示用「打开界面」按钮（它会带上 cookie）。
 */
async function resolveCopyableUrl(): Promise<string> {
  const port = activePort ?? DEEPSEEK_HARNESS_PORTS[0];
  const access = await resolveDashboardAccess(port);
  if (access.token) {
    return access.token;
  }
  if (access.cookie) {
    // 再确认一次这个实例还认这个 cookie（可能已经被重启换过密钥），
    // 保证复制出去的地址在别处也说得通
    const authority = new URL(access.url).host;
    const alive = await verifyDshAuthCookie(
      port,
      authority,
      `${access.cookie.name}=${access.cookie.value}`,
    );
    if (!alive) {
      cachedAccess = null;
      return (await resolveDashboardAccess(port, true)).url;
    }
    logger.warn(
      `[${DS_LABEL}] 该实例用会话 cookie 登录、没有可复制的 token 地址；已复制普通地址，外部浏览器需用 dsh 终端里打印的带 token 地址`,
    );
  }
  return access.url;
}

// 打开 dsh dashboard 界面窗口（仅创建窗口，不管理服务生命周期）
async function createDshWindow(): Promise<void> {
  if (dshWindow && !dshWindow.isDestroyed()) {
    if (dshWindow.isMinimized()) {
      dshWindow.restore();
    }
    dshWindow.focus();
    return;
  }

  const port = activePort ?? DEEPSEEK_HARNESS_PORTS[0];
  const access = await resolveDashboardAccess(port);
  await applyDashboardCookie(access);

  dshWindow = new BrowserWindow({
    height: 900,
    width: 1400,
    autoHideMenuBar: true,
    webPreferences: {
      // 用独立分区：会话 cookie 持久化，且不与主窗口的会话互相影响
      partition: DS_WINDOW_PARTITION,
    },
  });

  dshWindow.loadURL(access.url);

  dshWindow.on('closed', () => {
    dshWindow = null;
  });
}

// ===== 大模型配置同步（cordis.patch.yml / .credentials.yaml） =====
//
// - 换算规则（哪些模型写哪条路由、哪些密钥写进凭据）：model-sync-plan.ts
// - 写入：dsh-config-providers.ts —— 直接按 dsh 0.2.0 的新文件布局写
//   `$DSH_HOME/profiles/web/cordis.patch.yml` 与 `$DSH_HOME/.credentials.yaml`
// - 对外入口：dsh-model-sync.ts —— 安装流程与模型配置页的「同步 API key」按钮共用
//
// 写入失败只记日志，不阻断安装：让用户在 dsh 的模型页（设置 → 模型）里自己配。

/** 给配置写入用的日志出口 */
const syncLogger: SyncLogger = createDshSyncLogger();

/** 写文件失败时的统一提示：不阻断安装，交给用户在 dsh 界面里配 */
function logManualConfigHint(reason: string): void {
  logger.warn(
    `[${DS_LABEL}] ${reason}；已跳过模型配置同步，不影响 dsh 本身运行。` +
      `请在 dsh 界面的「设置 → 模型」里手动添加提供方与 API key（或在 ${dshProfilePatchPath()} 里手写配置）`,
  );
}

/**
 * 用本项目的大模型配置初始化 dsh：写模型路由与凭据。
 * 没有配置模型、或写入失败时只警告，不阻断安装。
 */
async function onboardDeepseekHarness(): Promise<void> {
  const summary = await syncModelsIntoDshHarness({
    models: getLlmConfig().models ?? [],
    logger: syncLogger,
  });

  if (summary === null) {
    logManualConfigHint('写入 dsh 配置文件失败');
    return;
  }
  if (summary.length === 0) {
    // 具体原因（没有模型 / 全是没有密钥的模型）已由 syncModelsIntoDshHarness 记过日志
    return;
  }
  logger.log(
    `[${DS_LABEL}] 已写入 dsh 配置（.credentials.yaml / cordis.patch.yml）：${summary.join('；')}`,
  );
}

// ===== 内置插件预装：dsh-our-free-model（Our Free Model） =====
//
// 这个插件不随启动器打包分发，而是在用户主机上「按需下载」后装进 dsh 的 web profile：
// 用内置的 adm-zip 解压归档 zip，再执行 `dsh plugin add`。
// 装完无需单独重启：本模块本来就会在它之后才拉起 dsh web，所以插件会被正常加载。
//
// 注意：我们用的是纯 `dsh web`（npm 全局包），不是 DSHEAC/EAC 桌面整合包，
// 所以 README 里「桌面端不要用 link:/junction」的 profile 闸门不适用——
// `plugin add` 把插件以真实目录装进 profile 即可。
//
// 下载地址可配置：候选列表 OUR_FREE_MODEL_PLUGIN_DOWNLOAD_URLS（国内代理优先、
// GitHub 直连兜底），也可用环境变量 DSH_OUR_FREE_MODEL_PLUGIN_URL 覆盖
//（开发时可指向本地 zip 文件，免去联网；也可用来自建源）。

/** 插件在 package.json 里的名字（用于定位插件根目录与判重） */
const OUR_FREE_MODEL_PLUGIN_NAME = 'dsh-our-free-model';

/** 插件版本 tag（升级时只改这里一处） */
const OUR_FREE_MODEL_PLUGIN_TAG = 'v1.3.1';

/** 插件的 GitHub 归档地址 */
const OUR_FREE_MODEL_GITHUB_ARCHIVE_URL =
  `https://github.com/zouyuxuan122/dsh-our-free-model/archive/refs/tags/${OUR_FREE_MODEL_PLUGIN_TAG}.zip`;

/**
 * 插件发布压缩包地址候选列表，按优先级依次尝试，命中即止。
 *
 * 该仓库的 Release 只发布了源码归档（没有预编译 zip），但 `dsh plugin add` 装的
 * 本来就是源码目录，所以直接拉这个归档即可——解压后顶层是 `<repo>-<tag>/`，
 * 由 findPluginRoot 按 package.json.name 自动定位真正的插件根。
 *
 * 为什么不用单一 URL：国内直连 GitHub 经常连不上，插件预装会静默失败（只告警）。
 * 所以把国内可用的 GitHub 代理放在前面，GitHub 直连留作末位兜底
 * （网络通畅时第一个代理通常几秒内就通了，不会额外等待）。
 * 这里沿用项目里 Obsidian 的多源回退范式（见 pages/obsidian-app 的 OBSIDIAN_DOWNLOAD_URLS）。
 *
 * 升级版本时只改上面那个 tag；也可用环境变量 DSH_OUR_FREE_MODEL_PLUGIN_URL
 * 覆盖（开发时可指向本地 zip 文件，免去联网；也可用来自建源）。
 */
const OUR_FREE_MODEL_PLUGIN_DOWNLOAD_URLS: string[] = [
  // 环境变量优先：既是开发免联网的入口，也是自建源的接入点
  ...(process.env.DSH_OUR_FREE_MODEL_PLUGIN_URL
    ? [process.env.DSH_OUR_FREE_MODEL_PLUGIN_URL]
    : []),
  ...[
    'https://gh-proxy.org/',
    'https://ghfast.top/',
    'https://ghproxy.net/',
  ].map((proxy) => proxy + OUR_FREE_MODEL_GITHUB_ARCHIVE_URL),
  OUR_FREE_MODEL_GITHUB_ARCHIVE_URL,
];

/**
 * 缓存标记用的来源标识。
 * 刻意用 tag 而不是具体 URL：换代理源不该让用户重新下载同一个版本。
 */
const OUR_FREE_MODEL_PLUGIN_SOURCE_ID = process.env
  .DSH_OUR_FREE_MODEL_PLUGIN_URL || OUR_FREE_MODEL_PLUGIN_TAG;

/** 下载后解压、给 dsh 用的插件目录（落在用户数据目录下，跨启动稳定，便于缓存复用） */
function resolvePluginInstallDir(): string {
  return path.join(app.getPath('userData'), OUR_FREE_MODEL_PLUGIN_NAME);
}

/** 标记文件：记录上次下载来源，来源不变时跳过重复下载 */
function resolvePluginMarkerFile(): string {
  return path.join(resolvePluginInstallDir(), '.ofm-source.txt');
}

/**
 * 跟随重定向地把 URL 下载到本地文件。
 * 带超时：代理源连上但不返回时会一直挂着，必须超时才能换下一个源。
 */
function downloadFile(
  url: string,
  destPath: string,
  timeoutMs = 30000,
): Promise<void> {
  const agent = url.startsWith('https:') ? https : http;
  return new Promise<void>((resolve, reject) => {
    const request = agent.get(
      url,
      { headers: { 'User-Agent': 'ai-learning-assistant-launcher' } },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          const location = Array.isArray(res.headers.location)
            ? res.headers.location[0]
            : res.headers.location;
          const next = new URL(location, url).toString();
          downloadFile(next, destPath, timeoutMs).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`下载插件压缩包失败：HTTP ${status}`));
          return;
        }
        const file = createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (err) => file.close(() => reject(err)));
      },
    );
    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      reject(new Error(`下载插件压缩包超时（${timeoutMs / 1000} 秒）`));
    });
  });
}

/** 解压 zip 到目标目录（覆盖已有内容） */
function extractZip(zipPath: string, destDir: string): void {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  new AdmZip(zipPath).extractAllTo(destDir, true);
}

/**
 * 在解压目录里找到真正的插件根目录：即包含 package.json 且 name 为
 * OUR_FREE_MODEL_PLUGIN_NAME 的那一层（GitHub 归档 zip 顶层是 `<repo>-<tag>/`）。
 */
function findPluginRoot(extractedDir: string): string | null {
  const tryDir = (dir: string): string | null => {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg && pkg.name === OUR_FREE_MODEL_PLUGIN_NAME) {
          return dir;
        }
      } catch {
        /* 解析失败当作不是插件根目录 */
      }
    }
    return null;
  };
  const direct = tryDir(extractedDir);
  if (direct) {
    return direct;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(extractedDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const found = tryDir(path.join(extractedDir, entry));
    if (found) {
      return found;
    }
  }
  return null;
}

/** 判断候选地址是否指向本地文件（开发用 / 自建源指向本地磁盘） */
function isLocalZipSource(url: string): boolean {
  if (url.startsWith('file:')) {
    return true;
  }
  try {
    return existsSync(url);
  } catch {
    return false;
  }
}

/**
 * 依次尝试候选地址，把第一个成功的下载到 destPath。
 * 任何一个源失败（网络不通 / HTTP 非 200 / 超时）就换下一个源，
 * 全部失败时抛出最后一个错误，由调用方降级处理。
 */
async function downloadFileFromCandidates(
  urls: string[],
  destPath: string,
): Promise<string> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      logger.log(`[${DS_LABEL}] 尝试从该源下载插件：${url}`);
      await downloadFile(url, destPath);
      return url;
    } catch (e) {
      lastError = e;
      logger.warn(`[${DS_LABEL}] 该源不可用，换下一个：${e}`);
    }
  }
  throw new Error(
    `所有下载源均失败（${urls.length} 个）：${lastError ?? '未知原因'}`,
  );
}

/**
 * 取得插件目录：优先复用已下载且版本一致的缓存；否则下载并解压。
 * 返回可用于 `dsh plugin add` 的目录；任何失败都抛出，由调用方降级处理。
 * 若候选地址里有本地文件（或 file://），则直接用它、不联网。
 */
async function fetchOurFreeModelPlugin(): Promise<string> {
  const installDir = resolvePluginInstallDir();
  const markerFile = resolvePluginMarkerFile();
  const pkgPath = path.join(installDir, 'package.json');

  // 已有缓存且版本一致 → 直接复用，不联网
  if (
    existsSync(pkgPath) &&
    existsSync(markerFile) &&
    readFileSync(markerFile, 'utf-8').trim() ===
      OUR_FREE_MODEL_PLUGIN_SOURCE_ID
  ) {
    logger.log(
      `[${DS_LABEL}] 复用已下载缓存的 Our Free Model 插件（${installDir}）`,
    );
    return installDir;
  }

  // 本地地址（开发用）排在最前：命中就直接用，完全不联网
  const localSources = OUR_FREE_MODEL_PLUGIN_DOWNLOAD_URLS.filter(
    isLocalZipSource,
  );
  const remoteSources = OUR_FREE_MODEL_PLUGIN_DOWNLOAD_URLS.filter(
    (url) => !isLocalZipSource(url),
  );

  const tmpZip = path.join(
    tmpdir(),
    `${OUR_FREE_MODEL_PLUGIN_NAME}-${Date.now()}.zip`,
  );
  const extractDir = path.join(
    tmpdir(),
    `${OUR_FREE_MODEL_PLUGIN_NAME}-extract-${Date.now()}`,
  );

  let zipPath: string;
  let usedUrl: string;
  if (localSources.length > 0) {
    zipPath = localSources[0].startsWith('file:')
      ? fileURLToPath(localSources[0])
      : localSources[0];
    usedUrl = localSources[0];
    logger.log(`[${DS_LABEL}] 使用本地插件压缩包（${zipPath}）`);
  } else {
    zipPath = tmpZip;
    logger.log(
      `[${DS_LABEL}] 正在下载 Our Free Model 插件（共 ${remoteSources.length} 个候选源）...`,
    );
    usedUrl = await downloadFileFromCandidates(remoteSources, tmpZip);
  }

  logger.log(`[${DS_LABEL}] 正在解压插件压缩包 ...`);
  extractZip(zipPath, extractDir);
  const root = findPluginRoot(extractDir);
  if (!root) {
    throw new Error('插件压缩包内未找到 dsh-our-free-model 插件目录');
  }

  // 把插件根目录内容搬进稳定安装目录（先清后拷），并写来源标记
  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(installDir, { recursive: true });
  cpSync(root, installDir, { recursive: true });
  // 标记用版本标识而非本次实际用的 URL：换源不应导致同一版本被重新下载
  writeFileSync(markerFile, OUR_FREE_MODEL_PLUGIN_SOURCE_ID);
  logger.log(`[${DS_LABEL}] 插件来源：${usedUrl}`);

  // 清理临时文件（本地 zip 不动）
  try {
    if (zipPath === tmpZip) {
      rmSync(tmpZip, { force: true });
    }
    rmSync(extractDir, { recursive: true, force: true });
  } catch {
    /* 临时文件清理失败不影响安装 */
  }

  logger.log(`[${DS_LABEL}] Our Free Model 插件已就绪（${installDir}）`);
  return installDir;
}

/** 查询 dsh 的 web profile 是否已经装了 Our Free Model 插件（幂等判断） */
async function isOurFreeModelInstalled(): Promise<boolean> {
  try {
    const { stdout } = await commandLine.exec(
      'dsh',
      ['--profile', 'web', '--dump-config'],
      { logger: loggerFactory(DS_LABEL) },
    );
    // 正常结果里应只出现一个 `id: our-free-model`；只要出现就认为已装
    return /our-free-model/.test(stdout || '');
  } catch {
    // dump-config 失败（profile 尚不存在 / dsh 版本不支持）都视作未安装，交给下面的 add 兜底
    return false;
  }
}

/**
 * 把 Our Free Model 插件装进 dsh 的 web profile：先取插件目录（下载/复用缓存），
 * 再 `dsh plugin add`。整段非致命：装不上只告警、不阻断 dsh 本体安装与启动。
 * 返回 true 表示本次确实新增/重装了插件（用于调用方决定是否需要重启 dsh web）。
 */
async function installOurFreeModelPlugin(): Promise<boolean> {
  if (await isOurFreeModelInstalled()) {
    logger.log(`[${DS_LABEL}] Our Free Model 插件已安装，跳过预装`);
    return false;
  }
  let pluginDir: string;
  try {
    pluginDir = await fetchOurFreeModelPlugin();
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 获取 Our Free Model 插件失败（跳过预装）:`, e);
    return false;
  }
  // `dsh plugin add` 通常需要 pnpm；装不上只告警、不阻断（pnpm 只影响插件管理）
  await ensurePnpmReady();
  logger.log(
    `[${DS_LABEL}] 正在为 dsh 预装 Our Free Model 插件（来源：${pluginDir}）...`,
  );
  try {
    await commandLine.exec(
      'dsh',
      ['plugin', '--profile', 'web', 'add', pluginDir],
      { logger: loggerFactory(DS_LABEL) },
    );
  } catch (e) {
    logger.warn(`[${DS_LABEL}] dsh plugin add 失败（跳过预装）:`, e);
    return false;
  }
  logger.log(`[${DS_LABEL}] Our Free Model 插件预装完成`);
  return true;
}

// ===== 服务生命周期 =====

/**
 * 启动 dsh web（由本模块后台拉起），只以「端口可访问」作为就绪信号返回，
 * 不依赖 dsh 命令的 stdout 输出（带 token 的地址只是免登录打开的优化，抓不到就退回自签 cookie）。
 *
 * 用 dsh 的默认命令启动（不绕过它的 .cmd 包装）；黑窗问题在 spawn 选项上解决：
 * `windowsHide: true` 会带上 CREATE_NO_WINDOW，cmd.exe / node.exe 都以无窗口方式启动，
 * 不会弹控制台、也不会抢到前台。
 */
async function launchDshWeb(candidatePorts: number[]): Promise<number> {
  const ports =
    candidatePorts.length > 0 ? candidatePorts : await pickCandidates();
  const port = ports[0];
  const args = ['web', '--no-open', '--port', String(port)];
  logger.log(
    `[${DS_LABEL}] 启动 dsh web：dsh ${args.join(' ')}（后台常驻，端口 ${port}）`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn('dsh', args, {
      cwd: homedir(),
      detached: true,
      // 关键：无窗口启动，避免 GUI 进程拉起控制台程序时弹黑窗并抢前台
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    dshProcess = child;

    let settled = false;
    let buffer = '';
    let tokenUrl: string | null = null;

    /** reject 的同时打印错误日志（console + 界面命令行日志），保证失败原因可见 */
    const rejectWithLog = (message: string): void => {
      logger.error(message);
      reject(new Error(message));
    };

    /** 只监测端口就绪（根路径回 401），不等待 dsh 命令的 stdout 输出 */
    const confirmReady = async (): Promise<void> => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await probePortReady(port, 800)) {
          activePort = port;
          cachedAccess = null;
          logger.log(`[${DS_LABEL}] dsh web 已就绪：端口 ${port}`);
          settled = true;
          resolve();
          return;
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          settled = true;
          rejectWithLog(
            `dsh web 在就绪前退出（退出码 ${child.exitCode}）：${buffer.trim().slice(-500)}`,
          );
          return;
        }
        await new Promise((done) => setTimeout(done, 500));
      }
      // 就绪超时：不再打开界面，直接报错，避免打开一个还没就绪（401/404）的空白页
      settled = true;
      rejectWithLog(
        `等待 dsh web 就绪超时（${READY_TIMEOUT_MS / 1000 / 60} 分钟），已放弃打开界面；请检查 dsh 终端日志或稍后重试`,
      );
    };

    const onOutput = (chunk: Buffer): void => {
      const text = chunk.toString('utf-8');
      loggerFactory(DS_LABEL).log(text.trim());
      buffer += text;
      // 带 token 的地址只是「免登录打开」的优化：抓到就用，抓不到由后续自签 cookie 兜底。
      // 必须锚定在 `dsh web:` 前缀并带上 `?token=`，否则会误匹配到启动过程中其它插件
      // 打印的回环地址（如 dsh-wechat 的扫码页 `http://127.0.0.1:3080/wechat/qr`）。
      const matched =
        /dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]*)/.exec(buffer);
      if (matched && !tokenUrl) {
        tokenUrl = matched[1];
        activeUrl = tokenUrl;
      }
    };
    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);
    // stdout/stderr 都结束说明 dsh 进程真的退出了：
    // 此时按端口重新探测（兜底判断），并不再把它当成“正在运行”
    const onStreamEnd = (): void => {
      if (child.stdout?.destroyed && child.stderr?.destroyed) {
        if (dshProcess === child) {
          dshProcess = null;
        }
        void probePort(port, 1500).then((alive) => {
          if (!alive) {
            if (activePort === port) {
              activePort = null;
              activeUrl = null;
              cachedAccess = null;
            }
            if (!settled) {
              settled = true;
              rejectWithLog(
                `dsh web 启动失败（进程已退出）：${buffer.trim().slice(-500)}`,
              );
            }
          } else {
            // 进程退出了但端口还活着（端口上是别的实例）：以端口为准，
            // 交给正在运行的 confirmReady 按端口探测返回
          }
        });
      }
    };
    child.stdout?.on('end', onStreamEnd);
    child.stderr?.on('end', onStreamEnd);

    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        dshProcess = null;
        rejectWithLog(`启动 dsh web 失败：${error.message}`);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectWithLog(
          `等待 dsh web 启动超时（${Math.floor(STARTUP_TIMEOUT_MS / 60000)} 分 ${(STARTUP_TIMEOUT_MS / 1000) % 60} 秒），输出：${buffer.trim().slice(-500)}`,
        );
      }
    }, STARTUP_TIMEOUT_MS);

    // 让子进程脱离父进程，Electron 退出后服务继续常驻
    child.unref();

    // 直接开始监测端口，不等待 dsh 命令的 stdout 输出
    void confirmReady();
  });

  // activeUrl 已由 onOutput 在抓到带 token 的地址时设置；这里不再兜底赋值，
  // 否则会把普通根地址写进 activeUrl，导致 resolveDashboardAccess 误以为已有 token 而跳过自签 cookie
  return activePort ?? port;
}

/** 候选端口里当前没人监听的（按候选顺序，第一个用来新起实例） */
async function pickCandidates(): Promise<number[]> {
  const results = await Promise.all(
    DEEPSEEK_HARNESS_PORTS.map((port) => probePort(port, 800)),
  );
  return DEEPSEEK_HARNESS_PORTS.filter((_, index) => !results[index]);
}

/**
 * 结束 dsh web。
 * 先按子进程句柄结束（本进程拉起的实例），若句柄已丢失（Electron 主进程重启过），
 * 就按端口号把监听进程找回来结束 —— 否则「停止」会变成空操作。
 */
async function killDshProcess(): Promise<boolean> {
  const child = dshProcess;
  const port = activePort;

  if (child?.pid) {
    dshProcess = null;
    logger.log(`[${DS_LABEL}] 结束 dsh web 进程（pid ${child.pid}）`);
    try {
      await commandLine.exec('taskkill', [
        '/pid',
        String(child.pid),
        '/T',
        '/F',
      ]);
    } catch (e) {
      logger.warn(`[${DS_LABEL}] 结束 dsh web 进程失败（可能已退出）:`, e);
    }
  }

  // 句柄没了、或进程树里还有残留（detached 的子进程）时，按端口兜底清理
  const needPortFallback =
    port !== null &&
    (child?.pid === undefined || (await probePort(port, 1000)));
  if (needPortFallback) {
    const stopped = await killDshByPort(port);
    if (!stopped) {
      return false;
    }
  }

  activePort = null;
  activeUrl = null;
  cachedAccess = null;
  return true;
}

/** 确保界面在运行：已有实例复用，没有则拉起；返回运行端口 */
async function ensureRunning(): Promise<number> {
  // 一次探测同时得到“有没有已在运行的实例”和“哪些候选端口是空闲的”
  const alive = await Promise.all(
    DEEPSEEK_HARNESS_PORTS.map((port) => probePort(port)),
  );
  const existingIndex = alive.findIndex((item) => item);
  if (existingIndex >= 0) {
    activePort = DEEPSEEK_HARNESS_PORTS[existingIndex];
    logger.log(
      `[${DS_LABEL}] 检测到已在运行的 dsh 实例（端口 ${activePort}），直接复用`,
    );
    return activePort;
  }

  if (await detectDshInstalled()) {
    const freePorts = DEEPSEEK_HARNESS_PORTS.filter(
      (_, index) => !alive[index],
    );
    return launchDshWeb(freePorts);
  }
  throwWithLog('未找到 dsh，请先安装 DeepSeek Harness');
}

/**
 * 确保 pnpm 可用：没有就通过 npm 全局安装（淘宝源）。
 * 返回是否可用；失败时只告警不抛错，由调用方决定「这次安装是否必须依赖 pnpm」
 * （dsh 已经装好时 pnpm 只影响插件管理，可以放行）。
 */
async function ensurePnpmReady(): Promise<boolean> {
  try {
    await ensurePnpmInstalled(commandLine, DS_LABEL, loggerFactory(DS_LABEL));
    return true;
  } catch (e) {
    logger.warn(`[${DS_LABEL}] pnpm 安装失败:`, e);
    return false;
  }
}

// ===== IPC 导出的业务函数 =====

export async function queryDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  const port = await detectRunningPort();
  if (port !== null) {
    activePort = port;
  }
  try {
    const version = await detectDshInstalled();
    if (version) {
      return { state: 'installed', version, running: port !== null, port };
    }
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 查询服务失败:`, e);
  }
  return { state: 'not_install', running: port !== null, port };
}

export async function installDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  setNpmRegistryTaobaoGlobal();

  // 按 node → npm → pnpm → dsh 的顺序逐个检查，缺哪个装哪个。
  // node/npm 必须先于 pnpm：pnpm 通过 npm 全局安装、npm 依赖 node，反过来（先查 pnpm）
  // 会在机器没装 node 时误报「pnpm 安装失败」并直接中断，导致根本没机会装 node。
  // （node 官方安装包自带 npm，所以 node 和 npm 一起由 ensureNode 保证）
  const nodeVersion = await ensureNode(commandLine, DSH_NODE_POLICY);
  logger.log(`[${DS_LABEL}] 使用 node v${nodeVersion}`);

  // pnpm 依赖 node/npm，必须在 node 之后检查
  const pnpmInstalled = await ensurePnpmReady();

  // dsh 是全局安装的：机器上已经有了就直接复用，不重复安装（用户可能自己在用）
  const installed = await detectDshInstalled();
  if (installed) {
    logger.log(
      `[${DS_LABEL}] 已检测到全局安装的 dsh v${installed}，复用现有安装（不重复安装）`,
    );
  } else {
    // 要重新装 dsh 时，pnpm 是必须的：装不上就直接报错，不继续往下走
    if (!pnpmInstalled) {
      throwWithLog('pnpm 安装失败，请检查网络后重试');
    }

    logger.log(
      `[${DS_LABEL}] 开始通过 npm 全局安装 ${DEEPSEEK_HARNESS_NPM_PACKAGE}（淘宝源）...`,
    );
    await runGlobalMaybeElevated(
      commandLine,
      'npm',
      [
        'install',
        '-g',
        `${DEEPSEEK_HARNESS_NPM_PACKAGE}@latest`,
        '--no-fund',
        '--no-audit',
        '--registry',
        TAOBAO_NPM_REGISTRY,
      ],
      loggerFactory(DS_LABEL),
      '安装 dsh',
    );
    // 安装后刷新 PATH：dsh 的命令放在 npm 的全局 bin 目录里
    await refreshPathAfterInstall(commandLine);
    const version = await detectDshInstalled();
    if (!version) {
      throwWithLog(
        'dsh 安装后仍不可用（可能安装失败或 PATH 未刷新），请重新运行安装',
      );
    }
    logger.log(`[${DS_LABEL}] dsh 安装完成：v${version}`);
  }

  // 用本项目的大模型配置初始化 dsh（cordis.patch.yml + .credentials.yaml）
  logger.log(`[${DS_LABEL}] 使用项目大模型配置同步 dsh 的模型配置 ...`);
  await onboardDeepseekHarness();

  // 预装内置的 Our Free Model 插件，让 dsh 启动后默认就带这个插件。
  // 非致命：装不上只告警，不影响 dsh 本体与界面启动。
  let pluginChanged = false;
  try {
    pluginChanged = await installOurFreeModelPlugin();
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 预装 Our Free Model 插件失败（不影响 dsh 本体）:`, e);
  }
  // 若本次刚装/升级了插件，且 dsh web 实例已在运行，先停掉再以全新实例启动，
  // 否则正在跑的旧实例不会加载新插件。
  if (pluginChanged && (await detectRunningPort()) !== null) {
    logger.log(`[${DS_LABEL}] 插件有更新，重启 dsh web 以加载新插件 ...`);
    await killDshProcess();
  }

  // 自动启动 Web 界面并打开窗口
  logger.log(`[${DS_LABEL}] 自动启动 DeepSeek Harness 界面 ...`);
  await ensureRunning();
  await createDshWindow();

  return queryDeepseekHarnessService();
}

export async function removeDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  const stopped = await stopDeepseekHarnessServiceInternal();

  // 端口上确实还有 dsh web 在跑（按端口反查也没能结束掉）：
  // 这时全局卸载会影响正在使用的实例，所以拒绝卸载并给出提示
  if (!stopped && activePort !== null) {
    throwWithLog(
      `端口 ${activePort} 上仍有正在运行的 dsh 实例，且未能结束它，已停止卸载。请先关闭该实例，再执行卸载`,
    );
  }

  if (!(await detectDshInstalled())) {
    logger.warn(`[${DS_LABEL}] 未检测到全局安装的 dsh，跳过卸载`);
    return queryDeepseekHarnessService();
  }

  logger.log(
    `[${DS_LABEL}] 开始通过 npm 全局卸载 ${DEEPSEEK_HARNESS_NPM_PACKAGE} ...`,
  );
  try {
    await runGlobalMaybeElevated(
      commandLine,
      'npm',
      ['uninstall', '-g', DEEPSEEK_HARNESS_NPM_PACKAGE],
      loggerFactory(DS_LABEL),
      '卸载 dsh',
    );
    await refreshPathAfterInstall(commandLine);
  } catch (e) {
    throwWithLog('卸载 dsh 失败', e);
  }

  return queryDeepseekHarnessService();
}

export async function runDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  // 启动前确保内置插件已装（首次或升级时自动补装）；非致命，装不上不影响启动。
  // 这一步让「dsh 早就在本机装好的老用户」在点击运行 / 启动 DSH 时也能自动获得该插件，
  // 而无需卸载重装——因为界面在 dsh 已装好后就不再显示「安装」按钮。
  // 注：运行按钮只在 dsh 未运行时出现，所以下面的 ensureRunning 会拉起全新实例并加载插件。
  try {
    await installOurFreeModelPlugin();
  } catch (e) {
    logger.warn(`[${DS_LABEL}] 预装 Our Free Model 插件失败（不影响启动）:`, e);
  }
  await ensureRunning();
  await createDshWindow();
  return queryDeepseekHarnessService();
}

/** 打开 DeepSeek Harness 界面窗口（不自动启动服务） */
export async function openDeepseekHarnessWindow(): Promise<DeepseekHarnessServiceInfo> {
  await createDshWindow();
  return queryDeepseekHarnessService();
}

/** 复制界面链接到剪贴板，方便用其他浏览器打开 */
export async function copyDeepseekHarnessDashboardUrl(): Promise<string> {
  const url = await resolveCopyableUrl();
  clipboard.writeText(url);
  return url;
}

/**
 * 停止逻辑的内部实现：关闭界面窗口，并结束 dsh web 进程。
 * 先按子进程句柄，句柄丢了（Electron 主进程重启过）就按端口号反查 —— 返回是否真的停下来了。
 */
async function stopDeepseekHarnessServiceInternal(): Promise<boolean> {
  // 关闭界面窗口
  if (dshWindow && !dshWindow.isDestroyed()) {
    dshWindow.close();
  }
  dshWindow = null;

  if (dshProcess === null && activePort === null) {
    logger.log(`[${DS_LABEL}] 没有正在运行的 dsh web，无需停止`);
    return true;
  }
  return killDshProcess();
}

export async function stopDeepseekHarnessService(): Promise<DeepseekHarnessServiceInfo> {
  await stopDeepseekHarnessServiceInternal();
  return queryDeepseekHarnessService();
}

// ===== 从 WorkBuddy 同步模型配置 =====

/**
 * 把 WorkBuddy 的自定义模型配置（`%USERPROFILE%\.workbuddy\models.json`）同步进 dsh。
 *
 * 写入前会把 `settings.yaml` / `.credentials.yaml` 整份备份到 `$DSH_HOME/backups/<时间戳>/`，
 * 备份结果随返回值一起交给界面展示（用户想回滚时直接拷回这两个文件即可）。
 *
 * 失败时抛出可直接展示给用户的错误（读不到 WorkBuddy 配置、没有可同步的模型、
 * dsh 自带的配置包不可用等）；抛错时还没有写任何东西。
 */
export async function syncWorkbuddyModelsToDsh(): Promise<WorkbuddyModelSyncResult> {
  const outcome = await syncWorkbuddyModelsIntoDshHarness({
    logger: syncLogger,
  });

  if (outcome === null) {
    logManualConfigHint('未能通过 dsh 自带的配置包写入 WorkBuddy 的模型配置');
    throw new Error(
      '未能使用 dsh 自带的配置包写入配置（可能尚未安装 dsh）。请在 dsh 界面的「设置 → 模型」里手动添加提供方与 API key',
    );
  }

  logger.log(
    `[${DS_LABEL}] 已把 WorkBuddy 的模型配置同步进 dsh（${outcome.syncedModels} 个模型 / ${
      outcome.routeCount
    } 条路由）：${outcome.summary.join('；')}`,
  );

  const workbuddyModelCount = outcome.syncedModels + outcome.notices.length;
  return {
    workbuddyModelCount,
    syncedModelCount: outcome.syncedModels,
    routeCount: outcome.routeCount,
    summary: outcome.summary,
    backup: {
      dir: outcome.backup.dir,
      files: outcome.backup.files,
      reused: outcome.backup.reused,
    },
    paths: outcome.paths,
    notices: outcome.notices,
    warnings: outcome.warnings,
  };
}

/**
 * 在系统文件管理器里打开 dsh 配置的备份目录。
 * 只允许打开 dsh home 下的备份目录，避免这条 IPC 被当成任意路径打开器。
 */
export async function openDeepseekHarnessBackupDir(
  dir?: string,
): Promise<string> {
  const root = dshBackupRoot();
  const target = (dir ?? '').trim() || root;

  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error(`只能打开 dsh 配置的备份目录：${root}`);
  }
  if (!existsSync(normalizedTarget)) {
    throw new Error(`备份目录还不存在：${normalizedTarget}`);
  }

  const failure = await shell.openPath(normalizedTarget);
  if (failure) {
    throw new Error(failure);
  }
  return normalizedTarget;
}

export default async function init(ipcMain: IpcMain) {
  // 退出前结束本程序拉起的 dsh web，避免后台残留（端口上的实例也会被一并清掉）
  app.on('before-quit', () => {
    void killDshProcess();
  });

  ipcHandle(ipcMain, queryDeepseekHarnessServiceHandle, async (_event) =>
    queryDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, installDeepseekHarnessServiceHandle, async (_event) =>
    installDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, removeDeepseekHarnessServiceHandle, async (_event) =>
    removeDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, runDeepseekHarnessServiceHandle, async (_event) =>
    runDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, stopDeepseekHarnessServiceHandle, async (_event) =>
    stopDeepseekHarnessService(),
  );
  ipcHandle(ipcMain, openDeepseekHarnessWindowHandle, async (_event) =>
    openDeepseekHarnessWindow(),
  );
  ipcHandle(ipcMain, copyDeepseekHarnessDashboardUrlHandle, async (_event) =>
    copyDeepseekHarnessDashboardUrl(),
  );
  ipcHandle(ipcMain, syncWorkbuddyModelsToDshHandle, async (_event) =>
    syncWorkbuddyModelsToDsh(),
  );
  ipcHandle(
    ipcMain,
    openDeepseekHarnessBackupDirHandle,
    async (_event, dir?: string) => openDeepseekHarnessBackupDir(dir),
  );
}
