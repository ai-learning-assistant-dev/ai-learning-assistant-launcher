import { BrowserWindow, IpcMain, clipboard } from 'electron';
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
import { appPath, Exec } from '../exec';
import { loggerFactory } from '../terminal-log';
import { getLlmConfig } from '../configs';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const commandLine = new Exec();

// bun 全局安装目录（bun add -g 的默认位置）
const openclawInstallPath = path.join(
  homedir(),
  '.bun',
  'install',
  'global',
  'node_modules',
  'openclaw',
);

// openclaw 安装时使用的 bun 工作目录
const openclawBunDir = path.join(
  appPath,
  'external-resources',
  'local-ai-service',
  'openclaw_bun',
);

// bun 配置文件（taobao 源 + 隔离 linker + 本地缓存）
const OPENCLAW_BUNFIG_TOML = `[install]
# 使用 taobao 源
registry = "https://registry.npmmirror.com"
linker = "isolated"
[install.cache]
dir = "./.bun/install/cache"
disable = false
`;

// 创建 openclaw bun 工作目录并写入 bunfig.toml
function ensureOpenclawBunWorkdir(): string {
  mkdirSync(openclawBunDir, { recursive: true });
  writeFileSync(
    path.join(openclawBunDir, 'bunfig.toml'),
    OPENCLAW_BUNFIG_TOML,
    {
      encoding: 'utf8',
    },
  );
  return openclawBunDir;
}

// openclaw dashboard 窗口实例
let openclawWindow: BrowserWindow | null = null;

// openclaw 网关后台进程句柄（用于停止时直接结束进程）
let openclawGatewayProcess: ChildProcessWithoutNullStreams | null = null;

// openclaw 配置文件路径
const openclawConfigPath = path.join(homedir(), '.openclaw', 'openclaw.json');

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

async function runOpenclawCli(
  args: string[],
  onSpawn?: (childProcess: ChildProcessWithoutNullStreams) => void,
): Promise<string> {
  const { stdout } = await commandLine.exec(
    'bun',
    ['run', '--bun', 'openclaw', ...args],
    {
      logger: loggerFactory('OPENCLAW'),
      onSpawn,
    },
  );
  return stdout;
}

// 探测网关指定路径，确认 HTTP 200 且（可选）满足就绪 JSON 契约
function probeGateway(
  pathname: string,
  expectReady = false,
): Promise<boolean> {
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
          // 就绪探针需满足 JSON 契约 {"ready": true}
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

// 检查网关是否完全就绪（/readyz 就绪探针）
async function checkGatewayReady(): Promise<boolean> {
  return probeGateway('/readyz', true);
}

// 等待网关完全就绪，最多等待 timeoutMs 毫秒
async function waitGatewayRunning(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkGatewayReady()) {
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

  // 关闭窗口仅销毁窗口，openclaw 网关继续在后台运行
  openclawWindow.on('closed', () => {
    openclawWindow = null;
  });
}

export async function queryOpenclawService(): Promise<OpenclawServiceInfo> {
  const running = await checkGatewayRunning();
  if (existsSync(openclawInstallPath)) {
    let version = '';
    try {
      const packageJson = JSON.parse(
        readFileSync(path.join(openclawInstallPath, 'package.json'), 'utf-8'),
      );
      version = packageJson.version || '';
    } catch (e) {
      console.warn('读取 openclaw 版本失败:', e);
    }
    return { state: 'installed', version, running };
  }
  return { state: 'not_install', running };
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

export async function installOpenclawService(): Promise<OpenclawServiceInfo> {

  const cwd = ensureOpenclawBunWorkdir();
  await commandLine.exec('bun', ['add', '-g', '--trust', 'openclaw@latest'], {
    logger: loggerFactory('OPENCLAW'),
    cwd,
  });
  await onboardOpenclaw();
  return queryOpenclawService();
}

export async function removeOpenclawService(): Promise<OpenclawServiceInfo> {
  // 卸载前先停止网关并关闭窗口
  await stopOpenclawService();
  await commandLine.exec('bun', ['remove', '-g', 'openclaw'], {
    logger: loggerFactory('OPENCLAW'),
  });
  return queryOpenclawService();
}

export async function runOpenclawService(): Promise<OpenclawServiceInfo> {
  if (!existsSync(openclawInstallPath)) {
    throw new Error('OpenClaw 未安装，请先安装');
  }

  // 网关未运行时先启动（后台常驻），并保存进程句柄以便停止
  if (!(await checkGatewayRunning())) {
    runOpenclawCli(['gateway', 'run'], (childProcess) => {
      openclawGatewayProcess = childProcess;
      childProcess.on('close', () => {
        if (openclawGatewayProcess === childProcess) {
          openclawGatewayProcess = null;
        }
      });
    }).catch(() => {
      // 网关进程被停止或异常退出，忽略（避免 unhandled rejection）
    });
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

  // 停止后台网关：优先结束已保存的进程句柄
  if (openclawGatewayProcess && !openclawGatewayProcess.killed) {
    try {
      openclawGatewayProcess.kill();
    } catch (e) {
      console.warn('结束 openclaw 网关进程失败:', e);
    }
  }
  openclawGatewayProcess = null;

  // 兜底：进程句柄不存在或已结束时，通过 CLI 停止
  try {
    await runOpenclawCli(['gateway', 'stop']);
  } catch (e) {
    console.warn('停止 openclaw 网关失败:', e);
  }

  return queryOpenclawService();
}
