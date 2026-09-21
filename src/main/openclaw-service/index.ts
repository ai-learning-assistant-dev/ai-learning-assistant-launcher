import { BrowserWindow, IpcMain, clipboard } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { CancellationToken } from '@podman-desktop/api';
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
import { loggerFactory } from '../terminal-log';
import { getLlmConfig } from '../configs';

const commandLine = new Exec();

// openclaw 官方 engines（建议的 node 版本范围）：Node 24.16+（24.x 内）或 Node 26.1+
// 参考 https://docs.openclaw.ai/install/node
const OPENCLAW_NODE_RANGE = '>=24.16.0 <25 || >=26.1.0';

// openclaw 的 Node 版本策略（Node 工具链的检测/自动安装统一走 node-toolchain）
const OPENCLAW_NODE_POLICY: NodeVersionPolicy = {
  label: 'OPENCLAW',
  range: OPENCLAW_NODE_RANGE,
  // 在线解析失败时的兜底版本（按优先级排序：先最新 LTS，再退到更早的 LTS 补丁版本，
  // 只有 LTS 全部不可用时才用非 LTS 版本）。正常联网时会在线挑选最新 LTS。
  fallbackReleases: [
    { version: '24.21.0', lts: 'Krypton' },
    { version: '24.20.0', lts: 'Krypton' },
    { version: '24.16.0', lts: 'Krypton' }, // openclaw 建议范围里的最低 LTS 版本
    { version: '26.1.0', lts: null }, // 最后兜底：非 LTS，但满足 openclaw 建议范围
  ],
};

// openclaw dashboard 窗口实例
let openclawWindow: BrowserWindow | null = null;

// openclaw 配置文件路径
const openclawConfigPath = path.join(homedir(), '.openclaw', 'openclaw.json');

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

// 确保 pnpm 已全局安装（没有时通过 npm 安装，走淘宝源）
async function ensurePnpmReady(): Promise<void> {
  // 先确保有满足 openclaw 建议版本的 node：node-toolchain 的 ensureNode 会刷新
  // PATH 后先检测、必要时下载官方 MSI 静默安装（进程启动时拿到的 PATH 是旧快照，
  // 用户可能在此期间手动装过 node，先同步到最新再检测，避免误判“未安装”）
  const nodeVersion = await ensureNode(commandLine, OPENCLAW_NODE_POLICY);
  console.log(`[OPENCLAW] 使用 node v${nodeVersion}`);
  try {
    await ensurePnpmInstalled(
      commandLine,
      'OPENCLAW',
      loggerFactory('OPENCLAW'),
    );
  } catch (e) {
    throwWithLog('pnpm 安装失败，请检查网络后重试', e);
  }
}

// 通过 pnpm 全局安装 openclaw
async function pnpmInstallOpenclaw(): Promise<void> {
  await ensurePnpmReady();
  console.log('[OPENCLAW] 开始通过 pnpm 全局安装 openclaw（淘宝源）...');
  await runGlobalMaybeElevated(
    commandLine,
    'pnpm',
    [
      'add',
      '-g',
      '--allow-build=openclaw',
      'openclaw@latest',
      '--registry',
      TAOBAO_NPM_REGISTRY,
    ],
    loggerFactory('OPENCLAW'),
    '安装 openclaw',
  );

  // 安装后刷新 PATH：openclaw 的命令放在 pnpm 的全局 bin 目录里，
  // 刷新后 runOpenclawCli 才能找到 openclaw
  await refreshPathAfterInstall(commandLine);

  try {
    await runOpenclawCli(['-V']);
  } catch (e) {
    throwWithLog('openclaw pnpm 全局安装失败，请检查网络后重试', e);
  }
}

// 通过 pnpm 全局卸载 openclaw
async function pnpmRemoveOpenclaw(): Promise<void> {
  await ensurePnpmReady();
  await runGlobalMaybeElevated(
    commandLine,
    'pnpm',
    ['remove', '-g', 'openclaw'],
    loggerFactory('OPENCLAW'),
    '卸载 openclaw',
  );
}

// 通过 node 运行 openclaw CLI
async function runOpenclawCli(
  args: string[],
  token?: CancellationToken,
): Promise<string> {
  const version = await detectSystemNode(commandLine, OPENCLAW_NODE_POLICY);
  if (!version) {
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

/** 模型的上下文窗口与最大输出（token） */
interface ModelLimits {
  contextWindow: number;
  maxTokens: number;
}

// openclaw 的自定义 provider（onboard --auth-choice custom-api-key）拿不到真实模型规格，
// 只会写入很小的默认值（contextWindow 16000 / maxTokens 4096），长上下文和长输出会被截断，
// 所以这里按模型补上实际值。数值按各家模型规格维护，后续新增模型在这里加一行即可。
const MODEL_LIMITS: Array<{ match: RegExp; limits: ModelLimits }> = [
  // DeepSeek：V4 系列 1M / 384k，reasoner 131k / 65k，chat 131k / 8k
  {
    match: /deepseek.*(v4|flash|pro)/i,
    limits: { contextWindow: 1000000, maxTokens: 384000 },
  },
  {
    match: /deepseek.*reasoner/i,
    limits: { contextWindow: 131072, maxTokens: 65536 },
  },
  { match: /deepseek/i, limits: { contextWindow: 131072, maxTokens: 8192 } },
  // OpenAI
  { match: /gpt-5/i, limits: { contextWindow: 400000, maxTokens: 128000 } },
  {
    match: /(gpt-4\.1|gpt-4o|gpt-4-turbo|chatgpt-4o)/i,
    limits: { contextWindow: 128000, maxTokens: 16384 },
  },
  {
    match: /(^|\/)o[134](-|$)/i,
    limits: { contextWindow: 200000, maxTokens: 100000 },
  },
  // Anthropic Claude
  { match: /claude/i, limits: { contextWindow: 200000, maxTokens: 8192 } },
  // Google Gemini
  { match: /gemini/i, limits: { contextWindow: 1048576, maxTokens: 65536 } },
  // xAI / Mistral
  { match: /grok/i, limits: { contextWindow: 131072, maxTokens: 8192 } },
  {
    match: /(mistral|magistral|devstral)/i,
    limits: { contextWindow: 131072, maxTokens: 8192 },
  },
];

// 未知模型（含 Ollama / LM Studio 本地模型）用保守值，避免写出超过模型能力的上限
const DEFAULT_MODEL_LIMITS: ModelLimits = {
  contextWindow: 32768,
  maxTokens: 4096,
};

// 按模型名解析上下文窗口/最大输出；名字看不出来时再按 provider 兜底
function resolveModelLimits(provider: string, modelName: string): ModelLimits {
  const matched = MODEL_LIMITS.find((item) => item.match.test(modelName || ''));
  if (matched) {
    return matched.limits;
  }
  // Azure 的部署名通常看不出模型，用 openclaw 自己的 Azure 默认值
  if ((provider || '').toLowerCase().includes('azure')) {
    return { contextWindow: 400000, maxTokens: 16384 };
  }
  return DEFAULT_MODEL_LIMITS;
}

// 把 contextWindow / maxTokens 写进 openclaw 配置里对应的模型条目
// （onboard 已经生成了 provider 和模型条目，这里只补这两个字段）
function applyOpenclawModelLimits(
  modelName: string,
  limits: ModelLimits,
): void {
  try {
    if (!existsSync(openclawConfigPath)) {
      console.warn(
        '[OPENCLAW] 未找到 openclaw 配置文件，跳过 contextWindow/maxTokens 写入',
      );
      return;
    }
    const config = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'));
    const providers = config?.models?.providers ?? {};
    for (const providerId of Object.keys(providers)) {
      const models = providers[providerId]?.models;
      const target = Array.isArray(models)
        ? models.find((item) => item?.id === modelName)
        : undefined;
      if (!target) {
        continue;
      }
      target.contextWindow = limits.contextWindow;
      target.maxTokens = limits.maxTokens;
      writeFileSync(
        openclawConfigPath,
        `${JSON.stringify(config, null, 2)}\n`,
        'utf-8',
      );
      console.log(
        `[OPENCLAW] 已为 ${providerId}/${modelName} 写入 contextWindow=${limits.contextWindow}、maxTokens=${limits.maxTokens}`,
      );
      return;
    }
    console.warn(
      `[OPENCLAW] openclaw 配置里没有找到模型 ${modelName}，跳过 contextWindow/maxTokens 写入`,
    );
  } catch (e) {
    console.warn(
      '[OPENCLAW] 写入 contextWindow/maxTokens 失败（不影响安装）:',
      e,
    );
  }
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

  // onboard 只会给自定义 provider 写入很小的默认上下文窗口/输出上限，这里按实际模型补上
  applyOpenclawModelLimits(
    model.name,
    resolveModelLimits(model.provider, model.name),
  );
}

export async function queryOpenclawService(): Promise<OpenclawServiceInfo> {
  const running = await checkGatewayRunning();
  try {
    const version = await detectSystemNode(commandLine, OPENCLAW_NODE_POLICY);
    if (version) {
      const cliVersion = await runOpenclawCli(['-V']);
      if (cliVersion) {
        return { state: 'installed', version: cliVersion || '', running };
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
  const nodeVersion = await detectSystemNode(commandLine, OPENCLAW_NODE_POLICY);
  if (nodeVersion) {
    try {
      await pnpmRemoveOpenclaw();
    } catch (e) {
      console.warn('卸载 openclaw pnpm 包失败:', e);
    }
  }
  return queryOpenclawService();
}

export async function runOpenclawService(): Promise<OpenclawServiceInfo> {
  const nodeVersion = await detectSystemNode(commandLine, OPENCLAW_NODE_POLICY);
  if (!nodeVersion) {
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
