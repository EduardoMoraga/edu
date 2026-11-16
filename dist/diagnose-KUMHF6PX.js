import {
  getManifestPath,
  hasTopLevelTomlKey,
  hostConfigDirs,
  isActionIntact,
  readTarget,
  samePath,
  tomlEnabledTables
} from "./chunk-EG3Z4IBZ.js";
import "./chunk-6VKNJRFI.js";
import "./chunk-BIXUCKST.js";
import "./chunk-AINX4RRX.js";
import "./chunk-LVU7A3FM.js";
import {
  binaryOnPath
} from "./chunk-KLV4TDB7.js";
import "./chunk-NMJNTHQG.js";
import {
  CLI_IDS
} from "./chunk-VP6QM6H5.js";

// src/doctor/diagnose.ts
import { readFile as readFile2, stat as stat2 } from "fs/promises";
import { homedir } from "os";
import { isAbsolute as isAbsolute2, join as join2, relative, resolve as resolve2, sep } from "path";

// src/doctor/native.ts
import { readFile, readdir, stat } from "fs/promises";
import { isAbsolute, join, resolve } from "path";
import { parse } from "jsonc-parser";
var isEduPlugin = (name) => /^edu@/i.test(name) || name.toLowerCase() === "edu";
async function text(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return void 0;
  }
}
async function json(path) {
  const raw = await text(path);
  if (raw === void 0) return void 0;
  const value = parse(raw);
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
async function names(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
async function claude(home, env) {
  const dir = hostConfigDirs(home, env).claude;
  const enabled = (await json(join(dir, "settings.json")))?.enabledPlugins;
  const flags = enabled && typeof enabled === "object" && !Array.isArray(enabled) ? enabled : {};
  const installed = (await json(join(dir, "plugins", "installed_plugins.json")))?.plugins;
  const candidates = /* @__PURE__ */ new Set([
    ...Object.entries(flags).filter(([name, on]) => isEduPlugin(name) && on === true).map(([name]) => name),
    ...(installed && typeof installed === "object" ? Object.keys(installed) : []).filter((name) => isEduPlugin(name) && flags[name] !== false)
  ]);
  return { found: [...candidates].sort().map((name) => `Claude plugin ${name}`), notes: [] };
}
async function codex(home, env) {
  const config = await text(join(hostConfigDirs(home, env).codex, "config.toml"));
  const found = [];
  const states = new Map([...tomlEnabledTables(config ?? "", "plugins")].filter(([name]) => isEduPlugin(name)));
  for (const [name, on] of states) if (on) found.push(`Codex plugin ${name}`);
  return { found, notes: [] };
}
async function pi(home, env) {
  const dir = hostConfigDirs(home, env).pi;
  const packages = (await json(join(dir, "settings.json")))?.packages;
  const result = { found: [], notes: [] };
  for (const entry of Array.isArray(packages) ? packages : []) {
    const source = typeof entry === "string" ? entry : entry && typeof entry === "object" && typeof entry.source === "string" ? entry.source : void 0;
    if (!source || !/(^|[/\\:@])edu-agent([/\\@#]|\.git|$)/i.test(source)) continue;
    if (/^(npm|git|https?|github):/i.test(source)) {
      result.found.push(`Pi package ${source}`);
      continue;
    }
    const path = isAbsolute(source) ? source : resolve(dir, source.replace(/^~(?=[/\\])/, home));
    if (await exists(path)) result.found.push(`Pi package ${source}`);
    else result.notes.push(`Pi package ${source} is registered but its folder is missing (${path}); run: edu setup --cli pi`);
  }
  return result;
}
async function opencode(home, env) {
  const found = [];
  const bases = [[join(home, ".config", "opencode"), "~/.config/opencode"], ...env.APPDATA ? [[join(env.APPDATA, "opencode"), "%APPDATA%\\opencode"]] : []];
  for (const [base, label] of bases) {
    const parts = [];
    const plugin = (await names(join(base, "plugins"))).find((name) => /^edu\.(ts|js|mjs)$/.test(name));
    if (plugin) parts.push(`plugins/${plugin}`);
    if ((await names(join(base, "commands"))).some((name) => /^edu-.+\.md$/.test(name))) parts.push("commands/edu-*.md");
    if (parts.length) found.push(`OpenCode files ${label} (${parts.join(", ")})`);
  }
  return { found, notes: [] };
}
async function agy(home) {
  const found = [];
  for (const relative2 of [".gemini/config/plugins/edu", ".gemini/antigravity-cli/plugins/edu", ".gemini/antigravity-cli/mcp/edu_edu"]) {
    if (await exists(join(home, ...relative2.split("/")))) found.push(`Antigravity plugin ~/${relative2}`);
  }
  return { found, notes: [] };
}
async function nativeIntegrations(home, env = {}) {
  const [c, x, p, o, a] = await Promise.all([claude(home, env), codex(home, env), pi(home, env), opencode(home, env), agy(home)]);
  return { claude: c, codex: x, pi: p, opencode: o, agy: a };
}

// src/doctor/diagnose.ts
async function readJson(path, valid) {
  let text2;
  try {
    text2 = await readFile2(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    return { error: `${path} cannot be read (${error.message})` };
  }
  try {
    const value = JSON.parse(text2);
    return valid(value) ? { value } : { error: `${path} is not a valid Edu record` };
  } catch (error) {
    return { error: `${path} is not valid JSON (${error.message})` };
  }
}
var manifestShape = (value) => !!value && typeof value === "object" && Array.isArray(value.actions);
var setupShape = (value) => !!value && typeof value === "object" && Array.isArray(value.native);
var NATIVE_HOSTS = ["claude", "codex", "pi", "agy"];
async function diagnose(options) {
  const root = resolve2(options.root);
  const home = resolve2(options.home ?? homedir());
  const env = options.env ?? {};
  const manifests = (await Promise.all(["project", "global"].map(async (scope) => ({
    scope,
    manifest: (await readJson(getManifestPath(scope, root, home), manifestShape)).value
  })))).map(({ scope, manifest }) => ({ scope, manifest: manifest && (manifest.scope ?? scope) === scope ? manifest : void 0 }));
  const setup = (await readJson(join2(home, ".edu/plugin-setup.json"), setupShape)).value;
  const codexConfig = await readTarget(join2(hostConfigDirs(home, env).codex, "config.toml")).catch(() => void 0);
  let userOwnsCodexNotify = false;
  try {
    userOwnsCodexNotify = codexConfig !== void 0 && hasTopLevelTomlKey(codexConfig.toString("utf8"), "notify");
  } catch {
  }
  const detect = options.detectBinary ?? binaryOnPath;
  const native = await nativeIntegrations(home, env);
  return Promise.all(CLI_IDS.map(async (cli) => {
    const notes = cli === "agy" ? ["agy MCP: manual step"] : [];
    if (cli === "codex" && userOwnsCodexNotify) notes.push("A user-owned top-level Codex notify command is preserved; Edu did not add its notify hook.");
    const scopes = [];
    const drifted = [];
    for (const { scope, manifest } of manifests) {
      const actions = manifest?.actions.filter((action) => (action.clis ?? [action.cli]).includes(cli)) ?? [];
      if (!actions.length) continue;
      scopes.push(scope);
      for (const action of actions) {
        const content = await readTarget(action.path).catch(() => void 0);
        if (!await isActionIntact(action, content)) drifted.push(action.path);
      }
    }
    for (const path of drifted) notes.push(`Edu-managed part changed or missing: ${path} (edu install refuses until it is restored; edu uninstall --force removes Edu's part anyway)`);
    if (NATIVE_HOSTS.includes(cli) && native[cli].found.length && !setup?.native?.includes(cli)) {
      notes.push(`${native[cli].found.join(", ")} is registered but no Edu setup record tracks it, so edu uninstall will not remove it. Run edu setup --yes --cli ${cli} to track it.`);
    }
    notes.push(...native[cli].notes);
    return { cli, installed: await detect(cli), integrated: scopes.length > 0 || native[cli].found.length > 0, drift: drifted.length > 0, scopes, native: native[cli].found, notes };
  }));
}
var QUARANTINE_LISTED = 5;
function quarantineProblem(scope, brainDir, notes, lang = "en") {
  if (!notes.length) return void 0;
  const shown = (path) => {
    const inside = relative(brainDir, path);
    return inside && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute2(inside) ? inside : path;
  };
  const paths = notes.map((note) => note.path).sort().slice(0, QUARANTINE_LISTED).map(shown).join(", ");
  const rest = notes.length - QUARANTINE_LISTED;
  const one = notes.length === 1;
  return {
    level: "warn",
    text: lang === "es" ? `cerebro ${scope}: ${notes.length} ${one ? "nota ilegible est\xE1" : "notas ilegibles est\xE1n"} en cuarentena (no se cargan ni se sobrescriben): ${paths}${rest > 0 ? ` y ${rest} m\xE1s` : ""}. Ejecuta edu brain lint para ver por qu\xE9 y c\xF3mo ${one ? "repararla" : "repararlas"}.` : `${scope} brain: ${notes.length} unreadable ${one ? "note is" : "notes are"} quarantined (not loaded, never overwritten): ${paths}${rest > 0 ? ` and ${rest} more` : ""}. Run edu brain lint to see why and how to repair ${one ? "it" : "them"}.`
  };
}
async function installProblems(options) {
  const root = resolve2(options.root);
  const home = resolve2(options.home ?? homedir());
  const problems = [];
  const paths = [.../* @__PURE__ */ new Set([getManifestPath("project", root, home), getManifestPath("global", root, home)])];
  for (const path of paths) {
    const read = await readJson(path, manifestShape);
    if (read.error) problems.push({ level: "fail", text: `Edu install manifest ${read.error.slice(path.length + 1)}: ${path}. Restore it from a backup or remove it, then run edu install again.` });
  }
  const setupPath = join2(home, ".edu/plugin-setup.json");
  const setup = await readJson(setupPath, setupShape);
  if (setup.error) problems.push({ level: "fail", text: `Edu setup record ${setup.error.slice(setupPath.length + 1)}: ${setupPath}. Remove it and run edu setup --yes.` });
  const recorded = setup.value?.packageRoot;
  if (recorded && setup.value?.native?.length) {
    const exists2 = await stat2(recorded).then(() => true, () => false);
    if (!exists2) problems.push({ level: "fail", text: `Edu setup points the host plugins at ${recorded}, which no longer exists. Run edu setup --yes to re-point them.` });
    else if (options.packageRoot && !samePath(recorded, resolve2(options.packageRoot))) {
      problems.push({ level: "warn", text: `Edu setup points the host plugins at ${recorded}, but this edu runs from ${resolve2(options.packageRoot)}. Run edu setup --yes to re-point them.` });
    }
  }
  return problems;
}
export {
  diagnose,
  installProblems,
  quarantineProblem
};
//# sourceMappingURL=diagnose-KUMHF6PX.js.map