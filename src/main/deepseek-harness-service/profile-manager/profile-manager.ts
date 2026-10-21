/**
 * DSH Profile 的七个基本操作：列出 / 查看 / 新建 / 删除 / 导出 / 导入 / 启动。
 *
 * 前六个只读写磁盘文件，不加载 DSH、不起它的运行时、不 spawn 任何外部命令。
 * 只有最后的 startProfile 会起一个 dsh 子进程，那是它唯一要做的事。
 *
 * 目录约定：
 *   $DSH_HOME/profiles/<name>/package.json       
 *   $DSH_HOME/profiles/<name>/cordis.patch.yml   
 *   $DSH_HOME/profiles/<name>/pnpm-workspace.yaml
 * 未设置 DSH_HOME 时，$DSH_HOME = ~/.dsh
 *
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  initProfile,
  loadOptionalPatches,
} from "@deepseek-ai/dsh-app-boot";

// 类型

export interface ProfileSummary {
  /** 目录名，也就是 Profile 的名字 */
  name: string;
  /** 绝对路径 */
  dir: string;
  /** dsh.profile.bundles 原样内容 */
  bundles: string[];
}

export interface BundleInfo {
  packageName: string;
  /** 解析不到包时为 null */
  version: string | null;
  /** bundle 自己声明的 patch 文件（绝对路径） */
  patchFile: string | null;
  /** patch 里 insert 的行数；文件不存在时为 0 */
  inserts: number;
}

export interface ProfileDetail extends ProfileSummary {
  /** Profile 自己的 dependencies */
  dependencies: Record<string, string>;
  /** 用户补丁层，绝对路径；没有该文件时为 null */
  patchFile: string | null;
  /** 用户补丁层里 insert 的行数 */
  inserts: number;
  /** 每个 bundle 的实际内容 */
  bundleInfo: BundleInfo[];
}

export interface CreateOptions {
  /** 用哪个随包模板，默认 "web"；可用值就是 PROFILE_TEMPLATES 的键 */
  template?: string;
  /** 直接指定 bundle 列表，优先于 template */
  bundles?: string[];
}

export interface ExportProfileOptions {
  /** 往哪写。已存在且非空则报错 */
  outDir: string;
  /** 是否连 pnpm-lock.yaml 一起带，默认不带 */
  includeLockfile?: boolean;
}

export interface ExportProfileResult {
  dir: string;
  /** 实际复制出去的文件名 */
  files: string[];
}

export interface ImportProfileOptions {
  /** 放进 profiles 之后叫什么。默认取源目录的目录名 */
  name?: string;
  /** 是否连 pnpm-lock.yaml 一起带，默认不带 */
  includeLockfile?: boolean;
}

export interface ImportProfileResult {
  name: string;
  dir: string;
  /** 实际复制进去的文件名 */
  files: string[];
}

export interface StartProfileOptions {
  /** dsh 可执行文件。默认取 $DSH_BIN，再回落到 "dsh" */
  bin?: string;
}

// 路径

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

/** $DSH_HOME，未设置则 ~/.dsh */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim();
  return fromEnv ? resolve(expandHome(fromEnv)) : join(homedir(), ".dsh");
}

/** 所有 Profile 所在的目录 */
export function profilesRoot(home: string = dshHome()): string {
  return join(home, "profiles");
}

// 列出

export async function listProfiles(root: string = profilesRoot()): Promise<ProfileSummary[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const result: ProfileSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const dir = join(root, entry.name);
    const pkg = await readJson(join(dir, "package.json"));
    const bundles = pkg?.dsh?.profile?.bundles;
    if (!Array.isArray(bundles)) continue; // 不是 Profile，跳过

    result.push({ name: entry.name, dir, bundles: bundles.map(String) });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// 查看

export async function inspectProfile(
  root: string = profilesRoot(),
  name: string,
): Promise<ProfileDetail> {
  const summary = (await listProfiles(root)).find((p) => p.name === name);
  if (!summary) throw new Error(`Profile 不存在：${name}（在 ${root} 下）`);

  const pkg = (await readJson(join(summary.dir, "package.json"))) ?? {};
  const patchFile = join(summary.dir, PROFILE_PATCH_FILENAME);

  const bundleInfo: BundleInfo[] = [];
  for (const bundleName of summary.bundles) {
    const manifestPath = findPackageManifest(summary.dir, bundleName);
    if (!manifestPath) {
      bundleInfo.push({ packageName: bundleName, version: null, patchFile: null, inserts: 0 });
      continue;
    }

    const manifest = (await readJson(manifestPath)) ?? {};
    // bundle 自己声明 patch 路径；没声明就用包根目录下的 cordis.patch.yml
    const declared: string = manifest?.dsh?.bundle?.patch ?? "./cordis.patch.yml";
    const bundlePatch = resolve(dirname(manifestPath), declared);

    bundleInfo.push({
      packageName: bundleName,
      version: manifest.version ?? null,
      patchFile: existsSync(bundlePatch) ? bundlePatch : null,
      inserts: countInserts(bundlePatch),
    });
  }

  return {
    ...summary,
    dependencies: (pkg.dependencies ?? {}) as Record<string, string>,
    patchFile: existsSync(patchFile) ? patchFile : null,
    inserts: countInserts(patchFile),
    bundleInfo,
  };
}

// 新建

/**
 * 新建一个 Profile
 *
 */
export async function createProfile(
  root: string = profilesRoot(),
  name: string,
  options: CreateOptions = {},
): Promise<ProfileSummary> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Profile 名不合法：${name}（只允许字母数字开头的单段名字）`);
  }

  const dir = join(root, name);
  if (existsSync(dir)) throw new Error(`目标已存在：${dir}`);

  const templateName = options.template ?? "web";
  const template = PROFILE_TEMPLATES[templateName as keyof typeof PROFILE_TEMPLATES];
  if (!template && !options.bundles) {
    const known = Object.keys(PROFILE_TEMPLATES).join(" / ");
    throw new Error(`未知模板：${templateName}（可选：${known}；也可以直接传 bundles）`);
  }

  const bundles = options.bundles ?? template.bundles;
  initProfile(dir, bundles, template?.patchReload);

  return { name, dir, bundles: [...bundles] };
}

// 删除

export async function removeProfile(
  root: string = profilesRoot(),
  name: string,
): Promise<{ name: string; dir: string }> {
  const target = (await listProfiles(root)).find((p) => p.name === name);
  if (!target) throw new Error(`Profile 不存在：${name}（在 ${root} 下）`);

  // 只删 profiles 根下的直接子目录，别的一律拒绝
  if (dirname(resolve(target.dir)) !== resolve(root)) {
    throw new Error(`拒绝删除：${target.dir} 不在 ${root} 下`);
  }

  await rm(target.dir, { recursive: true, force: true });
  return { name: target.name, dir: target.dir };
}

// 导出

/** 导出时带走的文件；存在才拷，不存在就跳过 */
const PROFILE_FILES = [
  "package.json",
  PROFILE_PATCH_FILENAME,
  "cordis.yml",
  "pnpm-workspace.yaml",
  "compatibility.json",
];

/**
 * 把 Profile 的配置文件复制到指定目录，得到一个能原样放回
 * $DSH_HOME/profiles/<名> 的目录。
 *
 * 只复制字节：不改写 package.json、不解释内容、不生成任何外层包格式。
 * node_modules、.dsh-module-fallback、*.bak-* 一律不带。
 */
export async function exportProfile(
  root: string = profilesRoot(),
  name: string,
  options: ExportProfileOptions,
): Promise<ExportProfileResult> {
  const summary = (await listProfiles(root)).find((p) => p.name === name);
  if (!summary) throw new Error(`Profile 不存在：${name}（在 ${root} 下）`);

  const outDir = resolve(options.outDir);
  if (existsSync(outDir) && (await readdir(outDir)).length > 0) {
    throw new Error(`目标目录已存在且不为空：${outDir}`);
  }

  const wanted = options.includeLockfile ? [...PROFILE_FILES, "pnpm-lock.yaml"] : PROFILE_FILES;

  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  for (const file of wanted) {
    const source = join(summary.dir, file);
    if (!existsSync(source)) continue;
    await copyFile(source, join(outDir, file));
    files.push(file);
  }

  return { dir: outDir, files };
}


// 导入

/**
 * 把一个 Profile 目录放回 $DSH_HOME/profiles/<名>，是 exportProfile 的反向操作。
 *
 * exportProfile 出去的目录能原样回来。但 Profile 若声明了自己 node_modules 里的本地插件需要重新安装依赖。
 * 安装依赖：dsh plugin --profile <Plugin> install
 */
export async function importProfile(
  root: string = profilesRoot(),
  sourceDir: string,
  options: ImportProfileOptions = {},
): Promise<ImportProfileResult> {
  const source = resolve(sourceDir);
  const name = options.name ?? basename(source);
  const dir = join(root, name);

  if (existsSync(dir)) throw new Error(`目标已存在：${dir}`);

  const wanted = options.includeLockfile ? [...PROFILE_FILES, "pnpm-lock.yaml"] : PROFILE_FILES;

  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const file of wanted) {
    const from = join(source, file);
    if (!existsSync(from)) continue;
    await copyFile(from, join(dir, file));
    files.push(file);
  }

  return { name, dir, files };
}


// 启动

/**
 * 用指定 Profile 启动 dsh，等于在终端敲 `dsh --profile <名>`。
 *
 * 只做两件事：拼参数、把 `DSH_HOME` 指到 `root` 的上一级
 * （这样 `root` 不必正好是 ~/.dsh/profiles）。子进程继承当前 stdio，
 * 输出直接进终端。返回子进程本身，退出码自己听。
 */
export async function startProfile(
  root: string = profilesRoot(),
  name: string,
  options: StartProfileOptions = {},
): Promise<ChildProcess> {
  const home = dirname(resolve(root));
  const bin = options.bin ?? process.env.DSH_BIN ?? "dsh";

  const child = spawn(bin, ["--profile", name], {
    stdio: "inherit",
    env: { ...process.env, DSH_HOME: home },
    // Windows 上 dsh 是 .cmd 垫片，Node 22 起必须经过 shell 才能起
    shell: process.platform === "win32",
  });

  // 等它真的起来再返回；起来了就不再等它退出
  await new Promise<void>((done, fail) => {
    child.once("spawn", () => done());
    child.once("error", (error) => fail(new Error(`启动 dsh 失败（${bin}）：${error.message}`)));
  });

  return child;
}


// 工具函数

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** 从 fromDir 逐级向上找 node_modules/<pkg>/package.json */
function findPackageManifest(fromDir: string, packageName: string): string | null {
  let current = resolve(fromDir);
  while (true) {
    const candidate = join(current, "node_modules", packageName, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * patch 是顶层数组，每行的 insert 数组里才是真正的 entry。
 *
 * 官方解析工具 `loadOptionalPatches`
 */
function countInserts(file: string): number {
  const patches = loadOptionalPatches("dsh-profile-lite", file);
  if (!patches) return 0;
  let count = 0;
  for (const row of patches) {
    if (Array.isArray(row.insert)) count += row.insert.length;
  }
  return count;
}
