import {
  exists
} from "./chunk-7USMROSH.js";
import {
  openBrain
} from "./chunk-VZNTNIW2.js";

// src/cli/setup.ts
import { cp, mkdir, readdir } from "fs/promises";
import { join } from "path";
async function initBrain(opts) {
  const { location, templatesDir } = opts;
  const name = opts.name?.trim() || "Edu";
  await mkdir(location.root, { recursive: true });
  await openBrain([location]).init(location, { identityName: name });
  const { defaultConfig, saveConfig } = await import("./config-SLXFEGWU.js");
  const configPath = join(location.root, "config.json");
  const defaultCli = opts.cli ?? opts.detected[0] ?? "claude";
  let configCreated = false;
  if (!await exists(configPath)) {
    await saveConfig(configPath, { ...defaultConfig(defaultCli), lang: opts.lang ?? "en" });
    configCreated = true;
  }
  const agents = await copyMissing(join(templatesDir, "agents"), join(location.root, "agents"));
  const skills = await copyMissing(join(templatesDir, "skills"), join(location.root, "skills"));
  return { root: location.root, defaultCli, configCreated, agents, skills };
}
async function copyMissing(from, to) {
  let entries;
  try {
    entries = await readdir(from);
  } catch {
    return [];
  }
  await mkdir(to, { recursive: true });
  const copied = [];
  for (const entry of entries.sort()) {
    const target = join(to, entry);
    if (await exists(target)) continue;
    await cp(join(from, entry), target, { recursive: true, errorOnExist: false, force: false });
    copied.push(entry);
  }
  return copied;
}

export {
  initBrain
};
//# sourceMappingURL=chunk-XI7L3C5X.js.map