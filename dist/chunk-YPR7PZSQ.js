// src/brain/location.ts
import { existsSync, realpathSync } from "fs";
import { readFile } from "fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "path";
function stopsAtCeiling(parent, env = process.env) {
  const list = env.EDU_CEILING_DIRECTORIES;
  if (!list) return false;
  const norm = (path) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  const target = norm(parent);
  return list.split(delimiter).filter(Boolean).some((entry) => norm(entry) === target);
}
function brainPath(location) {
  return location.brainDir ?? join(location.root, "brain");
}
function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
function resolveBrainDir(eduRoot, brainDir) {
  if (brainDir === void 0 || brainDir.trim() === "") return join(eduRoot, "brain");
  const workspace = dirname(resolve(eduRoot));
  const target = resolve(workspace, brainDir);
  if (isAbsolute(brainDir) || !isInside(workspace, target) || target === workspace) {
    throw new Error(`Invalid brainDir "${brainDir}" in ${join(eduRoot, "config.json")}: use a folder inside the workspace, e.g. "01-KNOWLEDGE"`);
  }
  return target;
}
var text = (value) => typeof value === "string" && value.trim() ? value.trim() : void 0;
async function readWorkspaceSettings(eduRoot) {
  let raw;
  try {
    raw = JSON.parse(await readFile(join(eduRoot, "config.json"), "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const config = raw;
  const settings = {};
  const brainDir = text(config.brainDir);
  if (brainDir) settings.brainDir = brainDir;
  const sourcesDir = text(config.sourcesDir);
  if (sourcesDir) settings.sourcesDir = sourcesDir;
  if (config.lang === "en" || config.lang === "es") settings.lang = config.lang;
  const identity = config.identity;
  const name = text(identity?.name);
  if (identity && typeof identity === "object" && name) {
    settings.identity = { name, ...text(identity.role) ? { role: text(identity.role) } : {}, ...text(identity.tone) ? { tone: text(identity.tone) } : {}, ...text(identity.summary) ? { summary: text(identity.summary) } : {} };
  }
  return settings;
}
async function withBrainDir(location) {
  if (location.brainDir) return location;
  const { brainDir } = await readWorkspaceSettings(location.root);
  return brainDir ? { ...location, brainDir: resolveBrainDir(location.root, brainDir) } : location;
}
function vaultPlacement(location) {
  const brain = brainPath(location);
  let real = brain;
  try {
    real = realpathSync(brain);
  } catch {
  }
  for (let dir = dirname(real); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, ".obsidian"))) return { vault: dir, brainRel: relative(dir, real).split(sep).join("/") };
  }
  return void 0;
}
function vaultFolder(location, folder) {
  const placed = vaultPlacement(location);
  if (placed) return `${placed.brainRel}/${folder}`;
  if (!location.brainDir) return `brain/${folder}`;
  const rel = relative(dirname(resolve(location.root)), location.brainDir).split(sep).join("/");
  return `${rel}/${folder}`;
}

export {
  stopsAtCeiling,
  brainPath,
  isInside,
  resolveBrainDir,
  readWorkspaceSettings,
  withBrainDir,
  vaultPlacement,
  vaultFolder
};
//# sourceMappingURL=chunk-YPR7PZSQ.js.map