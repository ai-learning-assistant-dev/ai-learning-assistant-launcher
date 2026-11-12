/**
 * DeepSeek Harness 桌面安装包（官网 https://www.deepseek.com/harness/ 提供的安装器）。
 *
 * 和之前通过 npm 全局安装 `@deepseek-ai/dsh` 不同，桌面安装包自带运行时：
 * - `resources/runtime/cli/bin/dsh.cmd` 是完整的 dsh CLI（用安装包内的 Electron 以 Node 模式运行），
 *   所以不需要系统安装 Node / npm，也不依赖 `dsh` 是否在 PATH 里；
 * - `resources/runtime/primary-runtime/dependencies/pnpm` 是内置 pnpm，
 *   `dsh plugin` 直接用它装插件，不需要系统 pnpm。
 *
 * 因此本模块负责：
 * 1. 下载官网安装包（固定文件名 dsh-latest-windows-x64.exe，始终指向最新版）；
 * 2. 静默运行安装包（NSIS：/S /currentuser），并等待注册表里出现安装记录；
 * 3. 从注册表（Uninstall 项）找到安装目录、版本和卸载命令；
 * 4. 启动 / 停止 / 探测桌面版主进程（启动器只启动桌面版，不再跑 `dsh web`）；
 * 5. 用注册表里的 QuietUninstallString（/currentuser /S）静默卸载。
 */

import {
  createWriteStream,
  existsSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { get as httpsGet } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'cross-spawn';
import { rcompare, valid } from 'semver';
import type { SyncLogger } from './dsh-config-providers';

const DS_LABEL = 'DEEPSEEK_HARNESS';

/** 官网下载页：安装包链接就是从这个页面提供的 */
export const DSH_DESKTOP_DOWNLOAD_PAGE = 'https://www.deepseek.com/harness/';

/**
 * 官网提供的 Windows 安装包地址（页面上的「Windows（64 位）」按钮）。
 * 文件名固定为 dsh-latest-windows-x64.exe，内容始终是最新版本。
 */
export const DSH_DESKTOP_DOWNLOAD_URL =
  'https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe';

/** 安装包自带的 dsh 命令相对安装目录的位置 */
const DSH_CLI_RELATIVE_PATH = path.join(
  'resources',
  'runtime',
  'cli',
  'bin',
  'dsh.cmd',
);

/** 安装目录里的卸载程序文件名（注册表读不到卸载命令时的兜底） */
const DSH_UNINSTALLER_FILE = 'Uninstall DeepSeek Harness.exe';

/** 桌面版主程序文件名 */
const DSH_EXECUTABLE_FILE = 'DeepSeek Harness.exe';

/** 关闭桌面版时等待进程退出的上限 */
const STOP_TIMEOUT_MS = 30 * 1000;

/** 注册表 Uninstall 项里属于 DeepSeek Harness 的 DisplayName 前缀 */
const DSH_DISPLAY_NAME_PATTERN = /^DeepSeek Harness(?:\s|$)/i;

/** 安装包下载完成后的最低大小：正常约 280MB，明显小于这个值说明下载不完整 */
const MIN_INSTALLER_BYTES = 50 * 1024 * 1024;

/** 安装后等待注册表出现记录的上限 */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

/** 卸载程序结束后等待安装目录消失的上限 */
const UNINSTALL_TIMEOUT_MS = 2 * 60 * 1000;

/** 静默安装参数（--updated 让安装包装完不要自动拉起界面，由本程序统一启动） */
const INSTALLER_ARGS = ['/S', '/currentuser', '--updated'];

/** 从注册表读出来的一条 Uninstall 记录（只保留这里用得到的字段） */
interface UninstallEntry {
  displayName?: string;
  displayVersion?: string;
  installLocation?: string;
  uninstallString?: string;
  quietUninstallString?: string;
}

/** 卸载程序：命令 + 参数 */
export interface DshUninstaller {
  command: string;
  args: string[];
}

/** 一次桌面版安装：安装目录、dsh 命令、版本与卸载程序 */
export interface DshDesktopInstall {
  installDir: string;
  /** 安装包自带的 dsh.cmd 绝对路径（调用时不用依赖 PATH） */
  command: string;
  version?: string;
  uninstaller?: DshUninstaller;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 连子进程一起结束（dsh.cmd 会再拉起 Electron，只杀 cmd.exe 会留下残余） */
function taskkillTree(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => resolve(false));
      killer.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/** 超时/失败路径用的「发了就不管」版本 */
function killProcessTree(pid: number | undefined): void {
  if (pid) {
    void taskkillTree(pid);
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

/** 用隐藏窗口的方式跑 PowerShell，返回 stdout（UTF-8） */
function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      reject(new Error('PowerShell 命令执行超时'));
    }, 15_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `PowerShell 退出码 ${String(code)}`));
      }
    });
  });
}

/** 解析 PowerShell 输出的 JSON（单条或数组都归一成数组；去掉可能的 UTF-8 BOM） */
function parsePowerShellJson<T>(raw: string): T[] {
  const text = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).trim();
  if (!text) {
    return [];
  }
  const parsed = JSON.parse(text) as T | T[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * 读当前用户 / 本机注册表里的 Uninstall 项，返回 DisplayName 以
 * 「DeepSeek Harness」开头的记录（安装包和卸载程序都会写在这里）。
 */
async function readUninstallEntries(
  logger: SyncLogger,
): Promise<UninstallEntry[]> {
  const script = [
    "$ErrorActionPreference='SilentlyContinue';",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
    "$roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall');",
    '$items=foreach($root in $roots){',
    '  Get-ChildItem -Path $root | ForEach-Object {',
    '    $p=Get-ItemProperty -Path $_.PSPath;',
    "    if($p.DisplayName -and $p.DisplayName -like 'DeepSeek Harness*'){",
    '      [pscustomobject]@{',
    '        displayName=$p.DisplayName;',
    '        displayVersion=$p.DisplayVersion;',
    '        installLocation=$p.InstallLocation;',
    '        uninstallString=$p.UninstallString;',
    '        quietUninstallString=$p.QuietUninstallString',
    '      }',
    '    }',
    '  }',
    '};',
    'if($items){@($items)|ConvertTo-Json -Compress}',
  ].join(' ');

  try {
    return parsePowerShellJson<UninstallEntry>(await runPowerShell(script));
  } catch (error) {
    logger.warn(
      `[${DS_LABEL}] 读取注册表里的 DeepSeek Harness 安装记录失败（继续尝试默认安装目录）:`,
      error,
    );
    return [];
  }
}

/**
 * 把注册表里的命令行拆成「可执行文件 + 参数」。
 * 兼容 `"C:\\...\\Uninstall X.exe" /currentuser /S` 这种带引号的写法。
 */
function splitWindowsCommand(
  commandLine: string,
): { command: string; args: string[] } | null {
  const text = commandLine.trim();
  if (!text) {
    return null;
  }

  let command: string;
  let rest: string;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    if (end < 0) {
      return null;
    }
    command = text.slice(1, end);
    rest = text.slice(end + 1);
  } else {
    const space = text.search(/\s/);
    if (space < 0) {
      return { command: text, args: [] };
    }
    command = text.slice(0, space);
    rest = text.slice(space + 1);
  }

  const args = rest.match(/"[^"]*"|\S+/g) ?? [];
  return {
    command,
    args: args.map((arg) => arg.replace(/^"|"$/g, '')),
  };
}

/** 安装目录 → 桌面版安装信息；dsh 命令不存在时返回 null（不完整的安装） */
function toDesktopInstall(
  installDir: string,
  version: string | undefined,
  uninstaller: DshUninstaller | undefined,
): DshDesktopInstall | null {
  const dir = path.normalize(installDir.trim());
  const command = path.join(dir, DSH_CLI_RELATIVE_PATH);
  if (!existsSync(command)) {
    return null;
  }
  return { installDir: dir, command, version, uninstaller };
}

/** 注册表里的 QuietUninstallString / UninstallString → 卸载程序 */
function parseUninstaller(entry: UninstallEntry): DshUninstaller | undefined {
  const raw = (
    entry.quietUninstallString ||
    entry.uninstallString ||
    ''
  ).trim();
  const parsed = raw ? splitWindowsCommand(raw) : null;
  return parsed ?? undefined;
}

/**
 * 查找桌面版安装。优先看注册表（支持用户自定义安装目录），
 * 注册表读不到时再检查默认安装目录 `%LOCALAPPDATA%\Programs\DeepSeek Harness`。
 * 返回版本最高的那条（可能有旧版本残留记录）。
 */
export async function findDshDesktopInstall(
  logger: SyncLogger,
): Promise<DshDesktopInstall | null> {
  const candidates: DshDesktopInstall[] = [];

  for (const entry of await readUninstallEntries(logger)) {
    const displayName = (entry.displayName || '').trim();
    if (!DSH_DISPLAY_NAME_PATTERN.test(displayName)) {
      continue;
    }
    const uninstaller = parseUninstaller(entry);
    const installDir =
      (entry.installLocation || '').trim() ||
      (uninstaller ? path.dirname(uninstaller.command) : '');
    const candidate = toDesktopInstall(
      installDir,
      (entry.displayVersion || '').trim() ||
        readRuntimeVersion(installDir) ||
        undefined,
      uninstaller,
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // 注册表读不到（或条目被清理过）时，再按安装包的默认目录兜底
  if (candidates.length === 0 && process.env.LOCALAPPDATA) {
    const defaultDir = path.join(
      process.env.LOCALAPPDATA,
      'Programs',
      'DeepSeek Harness',
    );
    const command = path.join(defaultDir, DSH_CLI_RELATIVE_PATH);
    if (existsSync(command)) {
      const uninstallerPath = path.join(defaultDir, DSH_UNINSTALLER_FILE);
      const fallback = toDesktopInstall(
        defaultDir,
        readRuntimeVersion(defaultDir),
        existsSync(uninstallerPath)
          ? { command: uninstallerPath, args: ['/currentuser', '/S'] }
          : undefined,
      );
      if (fallback) {
        candidates.push(fallback);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const versionRank = (item: DshDesktopInstall): string | null =>
    item.version && valid(item.version) ? item.version : null;
  candidates.sort((a, b) => {
    const va = versionRank(a);
    const vb = versionRank(b);
    if (va && vb) {
      return rcompare(va, vb);
    }
    return va ? -1 : vb ? 1 : 0;
  });
  return candidates[0];
}

/** 从安装包自带的 runtime.json 读桌面版本（注册表没有 DisplayVersion 时兜底） */
function readRuntimeVersion(installDir: string): string | undefined {
  const file = path.join(
    installDir,
    'resources',
    'runtime',
    'primary-runtime',
    'runtime.json',
  );
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    const document = JSON.parse(readFileSync(file, 'utf8')) as {
      desktopVersion?: unknown;
    };
    return typeof document.desktopVersion === 'string'
      ? document.desktopVersion
      : undefined;
  } catch (error) {
    console.warn(`[${DS_LABEL}] 读取 ${file} 失败:`, error);
    return undefined;
  }
}

/**
 * 运行安装包自带的 dsh 命令读出真实版本；失败返回 null。
 * 安装完成后用它确认「装上了、而且命令能跑」，而不是只看注册表。
 */
export async function readDshCommandVersion(
  command: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ['--version'];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      console.warn(`[${DS_LABEL}] 启动 ${command} --version 失败:`, error);
      resolve(null);
      return;
    }

    let stdout = '';
    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      resolve(null);
    }, 30_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      const version = stdout.trim().split(/\r?\n/).pop()?.trim() || null;
      resolve(version);
    });
  });
}

/** 桌面版主进程（Electron 主进程；渲染 / GPU / host 子进程不在这里） */
export interface DshDesktopProcess {
  pid: number;
}

interface ProcessEntry {
  pid?: number;
  exe?: string;
  commandLine?: string;
}

/** 读所有名为 DeepSeek Harness.exe 的进程（主进程、渲染进程、host、MCP 子进程都在内） */
async function readDesktopProcesses(
  logger: SyncLogger,
): Promise<ProcessEntry[]> {
  const script = [
    "$ErrorActionPreference='SilentlyContinue';",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
    '$items=Get-CimInstance Win32_Process -Filter "Name=\'DeepSeek Harness.exe\'" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; exe=$_.ExecutablePath; commandLine=$_.CommandLine } };',
    'if($items){@($items)|ConvertTo-Json -Compress}',
  ].join(' ');

  try {
    return parsePowerShellJson<ProcessEntry>(await runPowerShell(script));
  } catch (error) {
    logger.warn(
      `[${DS_LABEL}] 读取 DeepSeek Harness 进程失败（按“未运行”处理）:`,
      error,
    );
    return [];
  }
}

/** 这条进程记录的可执行文件是不是指定安装目录里的桌面版 exe */
function matchesInstallExecutable(
  entry: ProcessEntry,
  installDir: string,
): boolean {
  const expected = path
    .normalize(path.join(installDir, DSH_EXECUTABLE_FILE))
    .toLowerCase();
  const parsed = splitWindowsCommand(entry.commandLine || '');
  const executable = parsed?.command || (entry.exe || '').trim();
  return !!executable && path.normalize(executable).toLowerCase() === expected;
}

/**
 * 这条进程记录是不是指定安装目录里的桌面版**主进程**。
 *
 * 同一个 exe 还会以“脚本模式”拉起各种子进程（`--expose-internals <cli.js>`、
 * MCP server 的 `.mjs` 路径等），它们的命令行在 exe 后面跟一个脚本路径。
 * 主进程没有这种脚本参数（只可能有 `--xxx` 形式的 Chromium 开关），
 * 所以这里要求 exe 之后的参数全部以 `-` 开头。
 */
function isMainProcessForInstall(
  entry: ProcessEntry,
  installDir: string,
): boolean {
  if (!matchesInstallExecutable(entry, installDir)) {
    return false;
  }
  const parsed = splitWindowsCommand(entry.commandLine || '');
  if (!parsed) {
    // 拿不到命令行时只能按 exe 判断
    return true;
  }
  // 渲染 / GPU / utility 进程都带 --type=；主进程没有
  if (parsed.args.some((arg) => arg.toLowerCase().startsWith('--type='))) {
    return false;
  }
  return parsed.args.every((arg) => arg.startsWith('-'));
}

/** 查找指定安装目录下正在运行的桌面版主进程；没有返回 null */
export async function findDshDesktopProcess(
  installDir: string,
  logger: SyncLogger,
): Promise<DshDesktopProcess | null> {
  const matched = (await readDesktopProcesses(logger)).find(
    (entry) =>
      typeof entry.pid === 'number' &&
      entry.pid > 0 &&
      isMainProcessForInstall(entry, installDir),
  );
  return matched ? { pid: matched.pid as number } : null;
}

/** 启动桌面版（detached：本程序退出后桌面版继续运行）。只用于安装时初始化 desktop profile。 */
export function launchDshDesktop(
  install: DshDesktopInstall,
  logger: SyncLogger,
): Promise<void> {
  const executable = path.join(install.installDir, DSH_EXECUTABLE_FILE);
  if (!existsSync(executable)) {
    return Promise.reject(new Error(`桌面版主程序不存在：${executable}`));
  }
  logger.log(`[${DS_LABEL}] 启动 DeepSeek Harness 桌面版：${executable}`);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd: homedir(),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      reject(new Error(`启动 DeepSeek Harness 桌面版失败：${error.message}`));
    });
    child.on('spawn', () => {
      // 让桌面版脱离本进程，启动器退出 / 重启不影响它
      child.unref();
      resolve();
    });
  });
}

/** 指定安装目录下所有还在运行的进程（主进程 / 渲染进程 / host / MCP 子进程） */
async function listInstallProcessEntries(
  installDir: string,
  logger: SyncLogger,
): Promise<ProcessEntry[]> {
  return (await readDesktopProcesses(logger)).filter(
    (entry) =>
      typeof entry.pid === 'number' &&
      entry.pid > 0 &&
      matchesInstallExecutable(entry, installDir),
  );
}

/**
 * 关闭桌面版：先结束主进程（/T 会带走渲染进程和 host），再清掉可能遗留的
 * 旧版 `dsh web` / MCP 子进程，保证卸装时安装目录里的文件不被占用。
 * 返回是否已确认没有任何相关进程在运行。
 */
export async function stopDshDesktop(
  install: DshDesktopInstall,
  logger: SyncLogger,
): Promise<boolean> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const entries = await listInstallProcessEntries(install.installDir, logger);
    if (entries.length === 0) {
      return true;
    }

    const main = entries.find((entry) =>
      isMainProcessForInstall(entry, install.installDir),
    );
    const targets = main ? [main] : entries;
    for (const target of targets) {
      logger.log(
        `[${DS_LABEL}] 结束 DeepSeek Harness 进程（pid ${target.pid}）`,
      );
      // 失败通常是进程已随主进程一起退出；外层循环会再确认一次
      await taskkillTree(target.pid as number);
    }
    await delay(1000);
  }
  return (
    (await listInstallProcessEntries(install.installDir, logger)).length === 0
  );
}

/** 下载安装包到 target（跟随重定向，按 10% 打日志） */
function downloadInstaller(
  url: string,
  target: string,
  logger: SyncLogger,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    const succeed = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const request = (current: string, redirects: number): void => {
      const parsed = new URL(current);
      if (parsed.protocol !== 'https:') {
        fail(new Error(`安装包地址必须是 https：${current}`));
        return;
      }

      const req = httpsGet(
        current,
        {
          headers: { 'User-Agent': 'ai-learning-assistant-launcher' },
          timeout: 60_000,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const location = response.headers.location;
          if (status >= 300 && status < 400 && location) {
            response.resume();
            if (redirects >= 5) {
              fail(new Error('下载安装包时重定向次数过多'));
              return;
            }
            request(new URL(location, current).toString(), redirects + 1);
            return;
          }
          if (status !== 200) {
            response.resume();
            fail(new Error(`下载安装包失败：HTTP ${status}`));
            return;
          }

          const total = Number(response.headers['content-length'] || 0);
          let received = 0;
          let lastPercent = 0;
          let lastReportedBytes = 0;

          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (total > 0) {
              const percent = Math.min(
                100,
                Math.floor((received / total) * 100),
              );
              if (percent >= lastPercent + 10) {
                lastPercent = percent;
                logger.log(
                  `[${DS_LABEL}] 下载安装包 ${percent}%（${formatSize(
                    received,
                  )} / ${formatSize(total)}）`,
                );
              }
            } else if (received - lastReportedBytes >= 32 * 1024 * 1024) {
              lastReportedBytes = received;
              logger.log(`[${DS_LABEL}] 已下载安装包 ${formatSize(received)}`);
            }
          });

          const output = createWriteStream(target);
          response.on('error', (error) => {
            output.destroy();
            fail(new Error(`下载安装包失败：${error.message}`));
          });
          output.on('error', (error) => {
            response.destroy();
            fail(new Error(`保存安装包失败：${error.message}`));
          });
          output.on('finish', () => {
            if (total > 0 && received < total) {
              fail(
                new Error(
                  `下载安装包不完整（${formatSize(received)} / ${formatSize(
                    total,
                  )}），请检查网络后重试`,
                ),
              );
              return;
            }
            succeed();
          });
          response.pipe(output);
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('下载安装包超时'));
      });
      req.on('error', (error) => {
        fail(new Error(`下载安装包失败：${error.message}`));
      });
    };

    request(url, 0);
  });
}

/** 校验下载到的文件确实是一个完整的 Windows 安装包 */
function assertInstallerFile(target: string): void {
  const size = statSync(target).size;
  if (size < MIN_INSTALLER_BYTES) {
    throw new Error(
      `下载的安装包不完整（${formatSize(size)}），请检查网络后重试`,
    );
  }
  const fd = openSync(target, 'r');
  const header = Buffer.alloc(2);
  try {
    readSync(fd, header, 0, 2, 0);
  } finally {
    closeSync(fd);
  }
  if (header.toString('ascii') !== 'MZ') {
    throw new Error('下载到的文件不是 Windows 安装包，请检查网络后重试');
  }
}

/** 静默运行安装包，等它退出 */
function runInstaller(
  installerPath: string,
  logger: SyncLogger,
): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.log(
      `[${DS_LABEL}] 运行安装包（静默安装，可能需要几分钟）：${installerPath}`,
    );
    const child = spawn(installerPath, INSTALLER_ARGS, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(new Error(`无法运行安装包：${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (code === 1223) {
        reject(new Error('安装被取消（用户拒绝了安装）'));
        return;
      }
      const detail = output.trim().slice(-500);
      reject(
        new Error(`安装包退出码 ${String(code)}${detail ? `：${detail}` : ''}`),
      );
    });
  });
}

/** 轮询等待安装完成（安装包退出后注册表 / 文件可能需要一点时间落盘） */
async function waitForInstall(
  logger: SyncLogger,
): Promise<DshDesktopInstall | null> {
  const deadline = Date.now() + INSTALL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const install = await findDshDesktopInstall(logger);
    if (install) {
      return install;
    }
    await delay(2000);
  }
  return null;
}

/**
 * 下载并静默安装官网安装包，返回安装信息。
 * 安装包下载到系统临时目录，运行结束后删除。
 */
export async function installDshDesktop(
  logger: SyncLogger,
): Promise<DshDesktopInstall> {
  const installerPath = path.join(
    tmpdir(),
    `dsh-desktop-setup-${process.pid}-${Date.now()}.exe`,
  );

  try {
    logger.log(
      `[${DS_LABEL}] 从官网下载 DeepSeek Harness 安装包（下载页：${DSH_DESKTOP_DOWNLOAD_PAGE}）`,
    );
    logger.log(`[${DS_LABEL}] 安装包地址：${DSH_DESKTOP_DOWNLOAD_URL}`);
    await downloadInstaller(DSH_DESKTOP_DOWNLOAD_URL, installerPath, logger);
    assertInstallerFile(installerPath);
    logger.log(
      `[${DS_LABEL}] 安装包下载完成：${formatSize(statSync(installerPath).size)}`,
    );

    try {
      await runInstaller(installerPath, logger);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${detail}（也可以打开 ${DSH_DESKTOP_DOWNLOAD_PAGE} 手动下载安装）`,
      );
    }
  } finally {
    if (existsSync(installerPath)) {
      try {
        unlinkSync(installerPath);
      } catch (error) {
        logger.warn(
          `[${DS_LABEL}] 删除临时安装包失败（可手动删除）：${installerPath}`,
          error,
        );
      }
    }
  }

  logger.log(`[${DS_LABEL}] 安装包已结束，正在确认安装结果 ...`);
  const install = await waitForInstall(logger);
  if (!install) {
    throw new Error(
      `安装包已运行结束，但没有检测到 DeepSeek Harness 安装（默认目录：${
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness')
          : '未知'
      }）`,
    );
  }
  return install;
}

/**
 * 静默卸载桌面版：跑注册表里的 QuietUninstallString（没有就补 /S），
 * 然后等安装目录消失。卸载程序自己会清理注册表和快捷方式。
 */
export async function uninstallDshDesktop(
  install: DshDesktopInstall,
  logger: SyncLogger,
): Promise<void> {
  const uninstaller = install.uninstaller;
  if (!uninstaller) {
    throw new Error(
      `找不到 DeepSeek Harness 的卸载程序（安装目录：${install.installDir}）`,
    );
  }
  if (!existsSync(uninstaller.command)) {
    throw new Error(`卸载程序不存在：${uninstaller.command}`);
  }

  const args = uninstaller.args.some((arg) => arg.toLowerCase() === '/s')
    ? uninstaller.args
    : [...uninstaller.args, '/S'];
  logger.log(
    `[${DS_LABEL}] 运行卸载程序：${uninstaller.command} ${args.join(' ')}`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(uninstaller.command, args, {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      reject(new Error(`无法运行卸载程序：${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`卸载程序退出码 ${String(code)}`));
      }
    });
  });

  const deadline = Date.now() + UNINSTALL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!existsSync(install.command) || !existsSync(install.installDir)) {
      return;
    }
    await delay(1000);
  }

  throw new Error(
    '卸载程序已结束，但 DeepSeek Harness 的安装目录仍然存在：可能还有 DeepSeek Harness 进程在运行，请关闭后重试',
  );
}
