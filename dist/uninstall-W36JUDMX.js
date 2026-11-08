import {
  setupManifestPath,
  uninstallSetup
} from "./chunk-GHAYGKBT.js";
import "./chunk-TPI7PAJS.js";
import "./chunk-YAIL4E7R.js";
import "./chunk-ZFF2VUTT.js";
import "./chunk-BXZ573JQ.js";
import {
  getManifestPath,
  uninstall
} from "./chunk-AUCN5GYG.js";
import "./chunk-DGIFDAPF.js";
import "./chunk-RWOFVLBN.js";
import "./chunk-C4BNEOC5.js";
import "./chunk-VHSIB24T.js";
import "./chunk-ZVB2QYXP.js";
import "./chunk-KQ7WE6FL.js";
import "./chunk-XPGTBTXM.js";
import "./chunk-UTSDLJPR.js";
import "./chunk-2TESNY4V.js";
import "./chunk-I6JWASFE.js";
import "./chunk-2P2KBRRT.js";
import "./chunk-YPR7PZSQ.js";

// src/setup/uninstall.ts
import { lstat, readFile, realpath, rm, rmdir } from "fs/promises";
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
  try {
    return JSON.parse(await readFile(path, "utf8")).scope;
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
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
  const exists = await present(brainRoot);
  if (!options.purgeBrain || !exists) return { removed, brain: { path: brainRoot, action: exists ? "kept" : "absent" } };
  const target = await assertPurgeableBrain(brainRoot, home);
  if (await assertPurgeableBrain(target, home) !== target) throw new Error(`Refusing to purge ${brainRoot}: it moved during uninstall`);
  await rm(target, { recursive: true, force: true });
  if (join(home, ".edu") !== brainRoot) await rmdir(join(home, ".edu")).catch(() => void 0);
  return { removed, brain: { path: brainRoot, action: "purged" } };
}
export {
  assertPurgeableBrain,
  uninstallEdu
};
//# sourceMappingURL=uninstall-W36JUDMX.js.map