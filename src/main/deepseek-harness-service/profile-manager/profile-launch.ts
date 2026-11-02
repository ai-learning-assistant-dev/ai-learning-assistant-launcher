import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * 按 profile 启动 dsh。
 *
 * - `dsh --profile <name>` ;
 * - Electron 桌面版默认指定Profile，所以桌面版启动是无法更换Profile的。
 *
 * 请注意，启动器并不维持此处启动DSH实例的进程关系：
 * - 不保存 child 句柄、不做端口探测、不提供停止按钮；
 * - 输出留在用户自己的控制台窗口里，关掉窗口即结束；
 * - 启动器退出 / 重启完全不影响DSH实例。
 *
 * 与同目录 `startProfile()`（profile-manager.ts）的区别：那个是托管式启动，
 * 返回 child 句柄、把 stdout 交给调用方；这里是点火式，发完命令就撒手。
 *
 * 依赖边界（本目录保持"可单文件拷走"）：
 * - 只 import `node:*`，不 import 上级目录的模块；
 * - dsh 的安装位置由调用方以 `command` 传入，本文件不自己去探测；
 * - **不 import `./profile-manager`**：它顶层 import 了 `@deepseek-ai/dsh-app-boot`，
 *   而那个包在本项目里是 extraneous 依赖（没进 package.json），
 *   一旦被带进来，干净环境 `npm ci` 后构建会直接失败。
 *   代价是 `$DSH_HOME` 的解析在这里重写了一遍，三行，值得。
 */

/** 带浏览器界面的组合包：bundles 里有它，profile 启动后才有 GUI */
const WEB_APP_BUNDLE = '@deepseek-ai/dsh-web-app';

/** 桌面版独占的 profile，CLI 会拒绝启动 */
const DESKTOP_PROFILE = 'desktop';

/**
 * 一个已落盘的 dsh profile，够界面判断「这一项能不能点启动」。
 *
 * 注意「有没有界面」不等于「名字是不是 web」：`desktop` 也不在官方模板里，
 * 但它 bundles 里有 `@deepseek-ai/dsh-web-app`，所以有完整界面。
 * 判断依据只能是 bundles。
 */
export interface DshProfileInfo {
  name: string;
  /** bundles 里是否含 `@deepseek-ai/dsh-web-app`：有才会起浏览器界面 */
  hasUi: boolean;
  /** bundles 里第三方插件（非 `@deepseek-ai` 包）的个数，用于给用户一个规模印象 */
  pluginCount: number;
  /** 不能启动的原因；空表示可以启动 */
  unavailableReason?: string;
}

/** 一次启动请求的结果：只说明命令已发出，不代表 dsh 已经就绪 */
export interface DshProfileLaunchResult {
  /** 实际启动的 profile 名 */
  profile: string;
  /** 实际执行的命令行，便于用户在窗口没弹出来时手动粘贴排查 */
  commandLine: string;
}

/** 启动只需要一个 log 出口，避免为此 import 上级目录的日志类型 */
export interface DshProfileLaunchOptions {
  /** 安装包自带的 dsh 命令绝对路径（不依赖 PATH） */
  command: string;
  logger: { log(message: string): void };
}

/** profile 的 package.json 里我们关心的部分 */
interface ProfileManifest {
  dsh?: {
    profile?: {
      bundles?: unknown;
    };
  };
}

/** `$DSH_HOME`，未设置时用 `~/.dsh`（与 dsh 自身一致） */
function dshHomeDir(): string {
  const fromEnv = (process.env.DSH_HOME || '').trim();
  return fromEnv || path.join(homedir(), '.dsh');
}

/** 读一个 profile 的 bundles 清单；文件缺失 / 格式不对时当作空清单 */
function readProfileBundles(profileDir: string): string[] {
  const manifestPath = path.join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as ProfileManifest;
    const bundles = parsed.dsh?.profile?.bundles;
    if (!Array.isArray(bundles)) {
      return [];
    }
    return bundles.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** 不能启动的原因；返回 undefined 表示可以启动 */
function describeUnavailable(
  name: string,
  bundles: string[],
): string | undefined {
  if (name === DESKTOP_PROFILE) {
    return 'desktop 由 DeepSeek Harness 桌面版独占，命令行不允许启动；直接打开桌面版即可';
  }
  if (!bundles.includes(WEB_APP_BUNDLE)) {
    return '没有图形界面：这个 profile 只提供终端 / 协议服务，启动后不会打开任何界面';
  }
  return undefined;
}

/**
 * 列出 `$DSH_HOME/profiles` 下已经落盘的 profile，附带"能不能启动"的判断。
 *
 * 与同目录两个"列 profile"的函数分工：
 * - `listProfiles()`：磁盘上有哪些（消费者是详情 / 导出 / 导入）；
 * - `listBootableProfiles()`：已落盘 ∪ 随包模板（面向"能起什么"）；
 * - 本函数：只列已落盘的，因为模板里的名字磁盘上并不存在，
 *   列进下拉框后点下去必然起不来；同时给出"为什么不能启动"的原因。
 */
export function listDshProfiles(): DshProfileInfo[] {
  const profilesRoot = path.join(dshHomeDir(), 'profiles');
  if (!existsSync(profilesRoot)) {
    return [];
  }

  const profiles: DshProfileInfo[] = [];
  for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const profileDir = path.join(profilesRoot, entry.name);
    // 没有 package.json 说明这个目录还没被 dsh 初始化过，不列出来
    if (!existsSync(path.join(profileDir, 'package.json'))) {
      continue;
    }
    const bundles = readProfileBundles(profileDir);
    profiles.push({
      name: entry.name,
      hasUi: bundles.includes(WEB_APP_BUNDLE),
      pluginCount: bundles.filter(
        (bundle) => !bundle.startsWith('@deepseek-ai/'),
      ).length,
      unavailableReason: describeUnavailable(entry.name, bundles),
    });
  }

  // 能启动的排前面，组内按名字；界面默认选中第一项
  return profiles.sort((a, b) => {
    const aDisabled = a.unavailableReason ? 1 : 0;
    const bDisabled = b.unavailableReason ? 1 : 0;
    return aDisabled - bDisabled || a.name.localeCompare(b.name);
  });
}

/**
 * 在一个独立控制台窗口里启动命令。
 *
 * 为什么不直接 spawn dsh.cmd：Electron 主进程没有控制台，`detached` 的子进程
 * 更是一个控制台都没有，dsh 打印的 token、插件 skip 警告会全部丢掉，用户也失去了
 * "关掉窗口就停掉它"的手段。走 `start` 可以让 Windows 给目标程序分配一个新窗口。
 *
 * 第一个空字符串是 `start` 的窗口标题占位：少了它，start 会把带引号的命令本身当成标题。
 */
function spawnInOwnConsole(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', 'start', '', command, ...args], {
      cwd: homedir(),
      detached: true,
      stdio: 'ignore',
      // 只藏住这个中转的 cmd.exe，start 拉起的窗口照常显示
      windowsHide: true,
    });
    child.once('error', (error) => {
      reject(new Error(`打开命令窗口失败：${error.message}`));
    });
    child.once('spawn', () => {
      // 脱离本进程：启动器退出 / 重启不影响它
      child.unref();
      resolve();
    });
  });
}

/**
 * 按 profile 启动一套独立的工作台。
 *
 * 成功返回并不意味着服务即刻启动，仅仅是触发了启动命令：
 * dsh 起来后会自己打印带 token 的地址并在默认浏览器中打开，
 * 所以这里既不做就绪探测，也不返回 pid。
 */
export async function launchDshProfile(
  name: string,
  options: DshProfileLaunchOptions,
): Promise<DshProfileLaunchResult> {
  const profile = listDshProfiles().find((item) => item.name === name);
  if (!profile) {
    throw new Error(`没有找到 profile「${name}」，它可能已经被删除`);
  }
  if (profile.unavailableReason) {
    throw new Error(profile.unavailableReason);
  }
  if (!existsSync(options.command)) {
    throw new Error(`找不到安装包自带的 dsh 命令：${options.command}`);
  }

  // 不加 --no-open：dsh 会自己打开浏览器，这正是"点完就能用"的关键
  const args = ['--profile', profile.name];
  const commandLine = `${options.command} ${args.join(' ')}`;

  options.logger.log(
    `按 profile「${profile.name}」启动一套独立工作台（插件 ${profile.pluginCount} 个）：${commandLine}`,
  );
  await spawnInOwnConsole(options.command, args);
  options.logger.log(
    '命令已发出：dsh 会打印访问地址并自动打开浏览器；关掉弹出窗口将关闭DSH服务',
  );

  return { profile: profile.name, commandLine };
}
