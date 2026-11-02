/**
 * 一个例子：看有哪些 Profile，再新建一个，然后看它里面是什么，导出、再导回来，最后删掉。
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/main/deepseek-harness-service/profile-manager/document/usecase.mjs [<profiles 目录>] [<名字>]
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createProfile,
  exportProfile,
  importProfile,
  inspectProfile,
  listProfiles,
  profilesRoot,
  removeProfile,
} from "../profile-manager.ts";

const root = process.argv[2] ?? profilesRoot();
const name = process.argv[3] ?? "demo";

// ---------------------------------------------------------------- 查看
console.log(`Profile 目录: ${root}\n`);

const before = await listProfiles(root);
if (before.length === 0) {
  console.log("（这里还没有 Profile）");
} else {
  for (const p of before) {
    console.log(`  ${p.name.padEnd(16)} ${p.bundles.length} 个 bundle: ${p.bundles.join(", ")}`);
  }
}

// ---------------------------------------------------------------- 新建
const exists = before.some((p) => p.name === name);
if (exists) {
  console.log(`\n"${name}" 已经存在，跳过新建。`);
} else {
  const created = await createProfile(root, name);
  console.log(`\n已新建 "${name}" → ${created.dir}`);
}

// ---------------------------------------------------------------- 检查新建的Profile
const detail = await inspectProfile(root, name);
console.log(`\n"${detail.name}" 的内容:`);
console.log(`  依赖: ${Object.keys(detail.dependencies).join(", ") || "（无）"}`);
console.log(`  自己的补丁层: ${detail.patchFile ? `${detail.inserts} 条 insert` : "（没有 cordis.patch.yml）"}`);
for (const b of detail.bundleInfo) {
  const version = b.version ?? "未安装，解析不到";
  console.log(`  bundle ${b.packageName}  ${version}  自带 patch ${b.inserts} 条 insert`);
}

// ---------------------------------------------------------------- 导出
const outDir = await mkdtemp(join(tmpdir(), `export-${name}-`));
const exported = await exportProfile(root, name, { outDir });
console.log(`\n已导出到 ${exported.dir}`);
console.log(`  带走: ${exported.files.join(", ")}`);

// ---------------------------------------------------------------- 导回来
const restored = await importProfile(root, exported.dir, { name: `${name}-restored` });
console.log(`\n已导回为 "${restored.name}" → ${restored.dir}`);
console.log(`  放进去: ${restored.files.join(", ")}`);

// ---------------------------------------------------------------- 删除
const removed = [];
removed.push(await removeProfile(root, restored.name));
if (exists) {
  console.log(`\n"${name}" 在本次运行前就存在，保留不删。`);
} else {
  removed.push(await removeProfile(root, name));
}
console.log(`\n已删除: ${removed.map((p) => `${p.name} → ${p.dir}`).join("\n        ")}`);
console.log(`剩余: ${(await listProfiles(root)).map((p) => p.name).join(", ") || "（空）"}`);

// 想用它启动就这么写（示例里不自动执行，因为会真的把 dsh 跑起来）：
//   const child = await startProfile(root, name);
//   child.on("exit", (code) => console.log("dsh 退出:", code));
