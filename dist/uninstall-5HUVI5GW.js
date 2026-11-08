import {
  setupManifestPath,
  uninstallSetup
} from "./chunk-6LWDCFL2.js";
import "./chunk-UMNFFIZJ.js";
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
import "./chunk-W3BITYSE.js";
import "./chunk-KQ7WE6FL.js";
import "./chunk-WTXFW2MX.js";
import "./chunk-3CEC2RSP.js";
import "./chunk-GC5WYT3E.js";
import "./chunk-I6JWASFE.js";
import "./chunk-2P2KBRRT.js";
import "./chunk-YPR7PZSQ.js";

// src/setup/uninstall.ts
import { lstat, readFile, rm, rmdir } from "fs/promises";
import { join, parse, relative, resolve, sep } from "path";
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
async function assertPurgeableBrain(brainRoot, home) {
  const root = resolve(brainRoot);
  const rel = relative(root, resolve(home));
  if (root === parse(root).root || rel === "" || !rel.startsWith("..") && !rel.startsWith(sep)) {
    throw new Error(`Refusing to purge ${root}: it contains the home directory`);
  }
  const markers = await Promise.all(["EDU.md", "config.json"].map((name) => present(join(root, name))));
  if (!markers.some(Boolean)) throw new Error(`Refusing to purge ${root}: no EDU.md or config.json, so it is not an Edu brain`);
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
  await assertPurgeableBrain(brainRoot, home);
  await rm(brainRoot, { recursive: true, force: true });
  if (join(home, ".edu") !== brainRoot) await rmdir(join(home, ".edu")).catch(() => void 0);
  return { removed, brain: { path: brainRoot, action: "purged" } };
}
export {
  assertPurgeableBrain,
  uninstallEdu
};
//# sourceMappingURL=uninstall-5HUVI5GW.js.map