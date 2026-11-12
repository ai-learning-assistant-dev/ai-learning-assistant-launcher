/**
 * 确认可以被当作启动参数的Profile `dsh --profile <name>`。
 *
 * 与 `profile-manager.ts` 的 `listProfiles()` 的差异：
 *
 * | | `listProfiles()` | `listBootableProfiles()` |
 * |---|---|---|
 * | 回答的问题 | 磁盘上有哪些 Profile | 哪些名字能启动成功能跑的实例 |
 * | 集合 | 已落盘目录 | 已落盘目录 ∪ `PROFILE_TEMPLATES` |
 * | 用途 | 详情 / 导出 / 导入（都要求目录存在） | 拉起进程、界面下拉 |
 *
 * 为什么必须把模板算进来：`dsh-app-boot` 的 `loadProfile()` 在
 * `profiles/<名>/package.json` 缺失、且名字在 `PROFILE_TEMPLATES` 里时，
 * 会先 `initProfile(dir, template.bundles)` 自动创建再启动。也就是说
 * `acp` / `web` / `headless` / `sdk` / `sdk-minimal` 这 5 个名字即使目录还没建，
 * `dsh --profile <名>` 也能直接跑起来。只扫目录会把没建过的几个藏掉。
 *
 * 反过来，`listProfiles()` 不能跟着改成含模板：它的消费者里，
 * `inspectProfile` / `exportProfile` / `importProfile` 都以「目录存在」为前提，
 * 混进模板会立刻抛 `Profile 不存在`（`document/usecase.mjs` 就是直接受害者）。
 */
import {
  PROFILE_TEMPLATES,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot';
import { dshHome, listProfiles, profilesRoot } from './profile-manager';
import type { BootableProfile } from './types';

/**
 * dsh CLI 硬编码拒绝启动的 profile 名。
 *
 * 来源 `dsh/lib/bin.js:29`：
 *   if (profile.toLowerCase() === "desktop")
 *     program.error('error: profile "desktop" is managed exclusively by the Electron application');
 *
 * 这类 profile 仍然列出来（用户要知道它存在），但由调用方置灰并展示原因。
 */
const CLI_REFUSED_PROFILES: Record<string, string> = {
  desktop: '由 DSH 桌面端独占管理，dsh CLI 会直接拒绝启动',
};

/**
 * 列出所有可启动的 Profile。
 *
 * 已落盘与模板同名时以落盘的那份为准（用户可能改过 bundles，实际跑的是磁盘配置）。
 *
 * @param home - Harness home；默认 `$DSH_HOME`，未设置则 `~/.dsh`
 * @param preferred - 排在首位的名字。用参数传而不是 import 常量，
 *   这样本目录仍然只依赖 node 与 `@deepseek-ai/dsh-app-boot`，能单独拷走使用
 */
export async function listBootableProfiles(
  home: string = dshHome(),
  preferred = 'web',
): Promise<BootableProfile[]> {
  const materialized = await listProfiles(profilesRoot(home));
  const seen = new Set(materialized.map((item) => item.name));
  const result: BootableProfile[] = materialized.map((item) => ({
    name: item.name,
    dir: item.dir,
    bundles: item.bundles,
    materialized: true,
    unavailableReason: CLI_REFUSED_PROFILES[item.name.toLowerCase()] ?? null,
  }));

  for (const name of Object.keys(PROFILE_TEMPLATES)) {
    if (seen.has(name)) continue;
    result.push({
      name,
      dir: resolveProfileDir(name, home),
      bundles: [...PROFILE_TEMPLATES[name].bundles],
      // 目录还没有：首次 `dsh --profile <名>` 会按模板自动创建
      materialized: false,
      unavailableReason: CLI_REFUSED_PROFILES[name.toLowerCase()] ?? null,
    });
  }

  return result.sort((a, b) => {
    if (a.name === preferred) return -1;
    if (b.name === preferred) return 1;
    return a.name.localeCompare(b.name);
  });
}
