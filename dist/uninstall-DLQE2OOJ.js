import {
  uninstallDreamSchedules
} from "./chunk-ERXEPRYO.js";
import {
  scheduleFiles,
  uninstallSchedule
} from "./chunk-76KIILAA.js";
import {
  setupManifestPath,
  uninstallSetup
} from "./chunk-AJIDT4OC.js";
import "./chunk-MHUVV55D.js";
import "./chunk-W7AWSQHQ.js";
import "./chunk-FMFRO2B7.js";
import {
  getManifestPath,
  uninstall,
  withInstallLock
} from "./chunk-EG3Z4IBZ.js";
import "./chunk-6VKNJRFI.js";
import "./chunk-BIXUCKST.js";
import "./chunk-AINX4RRX.js";
import "./chunk-LVU7A3FM.js";
import "./chunk-KLV4TDB7.js";
import "./chunk-BDQUVGCN.js";
import "./chunk-KDSAKUP2.js";
import "./chunk-NMJNTHQG.js";
import "./chunk-ZJAEVUE2.js";
import "./chunk-YINGR2DA.js";
import "./chunk-YPR7PZSQ.js";
import "./chunk-VP6QM6H5.js";

// src/setup/uninstall.ts
import { lstat, readFile, readdir, realpath, rm, rmdir } from "fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "path";
async function present(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function manifestScope(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
  try {
    return JSON.parse(text).scope;
  } catch (error) {
    throw new Error(`Edu manifest ${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Restore it or remove it, then run again.`);
  }
}
async function emptyDirectory(path) {
  try {
    return (await lstat(path)).isDirectory() && !(await readdir(path)).length;
  } catch {
    return false;
  }
}
function comparable(path) {
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path;
}
function within(parent, child) {
  const rel = relative(comparable(parent), comparable(child));
  return rel === "" || !rel.startsWith("..") && !rel.startsWith(sep) && !isAbsolute(rel);
}
async function canonical(path) {
  const target = resolve(path);
  try {
    return await realpath(target);
  } catch (error) {
    if (error.code !== "ENOENT" || dirname(target) === target) throw error;
    return join(await canonical(dirname(target)), basename(target));
  }
}
async function kind(path) {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other";
  } catch (error) {
    if (error.code === "ENOENT") return "absent";
    throw error;
  }
}
var TIER_FOLDERS = ["0-index", "1-canonical", "2-episodic", "3-transitive"];
async function assertPurgeableBrain(brainRoot, home) {
  const lexical = resolve(brainRoot);
  const top = await kind(lexical);
  if (top === "link") throw new Error(`Refusing to purge ${lexical}: it is a symlink or junction`);
  if (top !== "dir") throw new Error(`Refusing to purge ${lexical}: not a directory, so it is not an Edu brain`);
  const root = await canonical(lexical);
  const homes = [resolve(home), await canonical(home)];
  if (root === parse(root).root || homes.some((h) => within(root, h))) {
    throw new Error(`Refusing to purge ${root}: it is or contains the home directory`);
  }
  const eduMd = await kind(join(root, "EDU.md"));
  const brain = await kind(join(root, "brain"));
  if (eduMd === "link" || brain === "link") throw new Error(`Refusing to purge ${root}: its EDU.md or brain/ is a symlink`);
  let layout = false;
  if (brain === "dir") layout = (await Promise.all(TIER_FOLDERS.map((name) => kind(join(root, "brain", name))))).some((k) => k === "dir");
  else if (brain === "absent") {
    try {
      layout = typeof JSON.parse(await readFile(join(root, "config.json"), "utf8"))?.brainDir === "string";
    } catch {
      layout = false;
    }
  }
  if (eduMd !== "file" || !layout) throw new Error(`Refusing to purge ${root}: no EDU.md with a brain/ tier layout, so it is not an Edu brain`);
  return root;
}
async function uninstallEdu(options) {
  return withInstallLock(resolve(options.home), () => uninstallEduLocked(options));
}
async function uninstallEduLocked(options) {
  const home = resolve(options.home);
  const cwd = resolve(options.cwd);
  const removed = [];
  if (options.scope !== "global") {
    const path = getManifestPath("project", cwd, home);
    if (await manifestScope(path) === "project") {
      await uninstall({ manifestPath: path, force: options.force });
      removed.push({ scope: "project", via: "manifest", path });
    }
  }
  if (options.scope !== "project") {
    const setup = await setupManifestPath(home);
    const adapter = getManifestPath("global", cwd, home);
    if (await present(setup)) {
      await uninstallSetup({ home, runner: options.runner, force: options.force });
      removed.push({ scope: "global", via: "setup", path: setup });
    }
    if (await manifestScope(adapter) === "global") {
      await uninstall({ manifestPath: adapter, force: options.force });
      removed.push({ scope: "global", via: "manifest", path: adapter });
    }
  }
  const brainRoot = resolve(options.brainRoot);
  const schedules = await removeSchedules(options, home, cwd, brainRoot);
  if (await emptyDirectory(brainRoot)) await rmdir(brainRoot).catch(() => void 0);
  const exists = await present(brainRoot);
  const brain = exists && await present(join(brainRoot, "EDU.md"));
  if (!options.purgeBrain || !exists) return { removed, schedules, brain: { path: brainRoot, action: !exists ? "absent" : brain ? "kept" : "not-a-brain" } };
  const target = await assertPurgeableBrain(brainRoot, home);
  if (await assertPurgeableBrain(target, home) !== target) throw new Error(`Refusing to purge ${brainRoot}: it moved during uninstall`);
  await rm(target, { recursive: true, force: true });
  if (join(home, ".edu") !== brainRoot) await rmdir(join(home, ".edu")).catch(() => void 0);
  return { removed, schedules, brain: { path: brainRoot, action: "purged" } };
}
async function removeSchedules(options, home, cwd, eduHome) {
  const platform = options.platform ?? process.platform;
  const run = options.serviceRun;
  const dreams = await uninstallDreamSchedules({ home, eduHome, platform, ...run ? { run } : {}, ...options.scope === "project" ? { cwd } : {} });
  const schedules = dreams.map((dream) => ({ ...dream }));
  if (options.scope === "project") return schedules;
  const sync = scheduleFiles(home, eduHome, platform);
  if (sync && (await Promise.all(sync.files.map(present))).some(Boolean)) {
    const result = await uninstallSchedule({ home, eduHome, platform, ...run ? { run } : {} });
    const name = result.kind === "schtasks" ? "EduSync" : result.kind === "launchd" ? "dev.edu.sync" : "edu-sync";
    schedules.push({ kind: result.kind, name, removed: result.removed, stopped: result.stopped });
  }
  return schedules;
}
export {
  assertPurgeableBrain,
  uninstallEdu
};
//# sourceMappingURL=uninstall-DLQE2OOJ.js.map