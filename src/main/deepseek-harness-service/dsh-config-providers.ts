/**
 * 直接用 dsh 自带的配置管理包读写 dsh 配置。
 *
 * dsh 把配置管理做成了可复用的包，就装在全局 dsh 的依赖里：
 * - `@deepseek-ai/dsh-settings-file`：`$DSH_HOME/settings.yaml` 的 provider（cordis 服务 `settings`），
 *   写入是**叶子级 diff**，注释、锚点、格式都会保留（dsh 模型页写的就是同一份文档）
 * - `@deepseek-ai/dsh-credentials-local`：`$DSH_HOME/.credentials.yaml` 的 provider（服务 `credentials`），
 *   负责 refs / records 的结构、文件锁、权限与并发合并
 *
 * 这两个包是 cordis 插件/服务，所以这里用一个最小的 cordis Context 把它们挂起来
 * （`watch: false`，不需要 timer / watcher），不启动整个 harness 就能拿到与 dsh 一致的写入语义。
 *
 * 加载方式：包是 ESM（`"type": "module"`），而启动器主进程是 webpack 打的 CJS bundle，
 * 因此用 `new Function('return import(...)')` 做动态导入——webpack 无法静态分析这行，
 * 会原样留给运行时；包路径从**全局 dsh 安装目录**解析，版本永远与用户机器上真正运行的 dsh 一致。
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeModelSyncIntoSettings } from './model-sync-plan';
import type { ModelSyncPlan } from './model-sync-plan';

/** 同步过程的日志出口（由 index.ts 接到界面命令行日志 / launcher.log） */
export interface SyncLogger {
  log(message: string): void;
  warn(message: string, cause?: unknown): void;
}

/** 执行外部命令并返回 stdout（index.ts 注入，用于兜底解析全局 npm 安装目录） */
export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<string>;

/** dsh 的命令行包名（全局安装） */
const DSH_PACKAGE = '@deepseek-ai/dsh';
const CORDIS_PACKAGE = '@deepseek-ai/cordis';
const SETTINGS_FILE_PACKAGE = '@deepseek-ai/dsh-settings-file';
const CREDENTIALS_LOCAL_PACKAGE = '@deepseek-ai/dsh-credentials-local';
const CREDENTIALS_PACKAGE = '@deepseek-ai/dsh-credentials';

/**
 * webpack 不会分析 `new Function` 里的代码，所以这行 `import()` 会原样留到运行时，
 * 由 Node 自己按 ESM 加载（CJS 里也能用动态 import）。
 */
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<Record<string, unknown>>;

/** 已解析到的全局 dsh 目录（只缓存成功结果，避免 dsh 还没装时被永久缓存成 null） */
let cachedDshDir: string | null = null;

/** 一个目录是不是全局安装的 dsh 包 */
function isDshPackageDir(dir: string): boolean {
  return existsSync(path.join(dir, 'package.json'));
}

/** 从 PATH 里找全局安装目录：npm 全局 bin 的隔壁就是全局 node_modules */
function findDshDirFromPath(): string | null {
  for (const raw of (process.env.PATH ?? '').split(path.delimiter)) {
    const entry = raw.trim().replace(/^"|"$/g, '');
    if (!entry) {
      continue;
    }
    const candidate = path.join(
      entry,
      'node_modules',
      ...DSH_PACKAGE.split('/'),
    );
    if (isDshPackageDir(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** 兜底：问 npm 全局 root（Executor 会把常见安装路径补进 PATH） */
async function findDshDirFromNpm(run: CommandRunner): Promise<string | null> {
  try {
    const stdout = await run('npm', ['root', '-g']);
    const root = stdout.trim().split(/\r?\n/).pop()?.trim() ?? '';
    if (!root) {
      return null;
    }
    const candidate = path.join(root, ...DSH_PACKAGE.split('/'));
    return isDshPackageDir(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** 定位全局安装的 dsh 包目录；null 表示找不到 */
export async function resolveDshPackageDir(
  run: CommandRunner,
): Promise<string | null> {
  if (cachedDshDir) {
    return cachedDshDir;
  }
  const found = findDshDirFromPath() ?? (await findDshDirFromNpm(run));
  if (found) {
    cachedDshDir = found;
  }
  return found;
}

/** dsh 配置包的最小结构（只声明本模块用到的部分） */
interface DshSettingsService {
  document?: Record<string, unknown>;
  persist(ns: string, section: unknown): Promise<void>;
}

interface DshCredentialsService {
  set(ref: string, value: string): Promise<void>;
}

interface DshContext {
  plugin(plugin: unknown, config?: unknown): { await(): Promise<unknown> };
  fiber?: { dispose?(): void };
  settings?: DshSettingsService;
  credentials?: DshCredentialsService;
}

interface DshConfigModules {
  Context: new () => DshContext;
  settingsFile: unknown;
  credentialsLocal: unknown;
  credentialRef(name: string): string;
}

/** 从全局 dsh 的依赖里解析并动态导入这几个包 */
async function loadDshConfigModules(dshDir: string): Promise<DshConfigModules> {
  // 以 dsh 包目录为基准解析：包可能嵌在 dsh/node_modules 下，也可能被提升到全局 node_modules
  const requireFromDsh = createRequire(path.join(dshDir, 'noop.js'));
  const entryOf = (pkg: string): string =>
    pathToFileURL(requireFromDsh.resolve(pkg)).href;

  const [cordis, settingsFile, credentialsLocal, credentials] =
    await Promise.all([
      importEsm(entryOf(CORDIS_PACKAGE)),
      importEsm(entryOf(SETTINGS_FILE_PACKAGE)),
      importEsm(entryOf(CREDENTIALS_LOCAL_PACKAGE)),
      importEsm(entryOf(CREDENTIALS_PACKAGE)),
    ]);

  return {
    Context: cordis.Context as DshConfigModules['Context'],
    // 两个 provider 的默认导出就是插件类
    settingsFile: settingsFile.default,
    credentialsLocal: credentialsLocal.default,
    credentialRef: credentials.credentialRef as (name: string) => string,
  };
}

/** 直接使用 dsh 配置包的一次写入会话 */
interface DshConfigSession {
  settings: DshSettingsService;
  credentials: DshCredentialsService;
  credentialRef(name: string): string;
  close(): Promise<void>;
}

/** 挂起一个最小 cordis Context，把 dsh 的两个配置 provider 装上 */
async function openDshConfigSession(
  dshDir: string,
  settingsPath: string,
  credentialsPath: string,
): Promise<DshConfigSession> {
  const modules = await loadDshConfigModules(dshDir);
  const ctx = new modules.Context();

  // watch: false —— 我们只写不监听，不需要 chokidar，也就不会留下常驻句柄
  await ctx
    .plugin(modules.settingsFile, { path: settingsPath, watch: false })
    .await();
  await ctx
    .plugin(modules.credentialsLocal, { path: credentialsPath, watch: false })
    .await();

  const { settings, credentials } = ctx;
  if (!settings || !credentials) {
    throw new Error('dsh 配置包挂载后没有注册出 settings / credentials 服务');
  }

  return {
    settings,
    credentials,
    credentialRef: modules.credentialRef,
    close: async (): Promise<void> => {
      // 所有写入都已经 await 过，这里只做优雅释放
      ctx.fiber?.dispose?.();
      await Promise.resolve();
    },
  };
}

/**
 * 用 dsh 自带的配置包把同步计划写进 `settings.yaml` / `.credentials.yaml`。
 *
 * @returns 写入摘要；`null` 表示 dsh 配置包不可用（调用方只记日志，提示用户去 dsh 界面里手动配）
 */
export async function applyModelSyncViaDshPackages(options: {
  plan: ModelSyncPlan;
  settingsPath: string;
  credentialsPath: string;
  run: CommandRunner;
  logger: SyncLogger;
}): Promise<string[] | null> {
  const { plan, settingsPath, credentialsPath, run, logger } = options;

  const dshDir = await resolveDshPackageDir(run);
  if (!dshDir) {
    logger.warn('没有找到全局安装的 dsh 包目录，无法加载 dsh 自带的配置包');
    return null;
  }

  let session: DshConfigSession;
  try {
    session = await openDshConfigSession(dshDir, settingsPath, credentialsPath);
  } catch (error) {
    logger.warn(`加载 dsh 自带的配置包失败（${dshDir}）`, error);
    return null;
  }

  try {
    const summary: string[] = [];

    // 1) 凭据：plan.credentials 里只会有非空密钥
    const refs = Object.entries(plan.credentials);
    if (refs.length > 0) {
      const failed: string[] = [];
      for (const [ref, value] of refs) {
        try {
          await session.credentials.set(session.credentialRef(ref), value);
        } catch (error) {
          failed.push(ref);
          logger.warn(`写入凭据 ${ref} 失败`, error);
        }
      }
      summary.push(
        failed.length === 0
          ? `${refs.length} 个凭据`
          : `${refs.length - failed.length}/${refs.length} 个凭据（${failed.join('、')} 写入失败）`,
      );
    }

    // 2) 模型路由 / 默认模型：先和当前文档合并，再按分节写入
    //    （persist 是整节替换，所以必须自己带上 dsh 里已有的其它路由）
    const document = session.settings.document ?? {};
    const { sections, summary: settingsSummary } = mergeModelSyncIntoSettings(
      document,
      plan,
    );
    for (const [ns, section] of Object.entries(sections)) {
      await session.settings.persist(ns, section);
    }
    summary.push(...settingsSummary);

    return summary;
  } catch (error) {
    logger.warn('通过 dsh 自带的配置包写入失败', error);
    return null;
  } finally {
    await session.close();
  }
}
