import {
  CLI_IDS,
  getManifestPath,
  hasTopLevelTomlKey,
  readTarget,
  sha256
} from "./chunk-5O6OTBMN.js";
import {
  binaryOnPath
} from "./chunk-ROTDA577.js";

// src/adapters/doctor.ts
import { readFile as readFile2 } from "fs/promises";
import { homedir } from "os";
import { join as join2, resolve as resolve2 } from "path";

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
  const dir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
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
  const config = await text(join(env.CODEX_HOME || join(home, ".codex"), "config.toml"));
  const found = [];
  let current;
  const states = /* @__PURE__ */ new Map();
  for (const line of (config ?? "").split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]/.exec(line)?.[1];
    if (heading) {
      const plugin = /^plugins\.(?:"([^"]+)"|([^.\s]+))$/.exec(heading.trim());
      current = plugin ? plugin[1] ?? plugin[2] : void 0;
      if (current && isEduPlugin(current) && !states.has(current)) states.set(current, true);
      continue;
    }
    if (current && states.has(current) && /^\s*enabled\s*=\s*false\b/.test(line)) states.set(current, false);
  }
  for (const [name, on] of states) if (on) found.push(`Codex plugin ${name}`);
  return { found, notes: [] };
}
async function pi(home, env) {
  const dir = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
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
  for (const relative of [".gemini/config/plugins/edu", ".gemini/antigravity-cli/plugins/edu", ".gemini/antigravity-cli/mcp/edu_edu"]) {
    if (await exists(join(home, ...relative.split("/")))) found.push(`Antigravity plugin ~/${relative}`);
  }
  return { found, notes: [] };
}
async function nativeIntegrations(home, env = {}) {
  const [c, x, p, o, a] = await Promise.all([claude(home, env), codex(home, env), pi(home, env), opencode(home, env), agy(home)]);
  return { claude: c, codex: x, pi: p, opencode: o, agy: a };
}

// src/adapters/doctor.ts
async function readManifest(path) {
  try {
    const value = JSON.parse(await readFile2(path, "utf8"));
    if (!value || typeof value !== "object" || !Array.isArray(value.actions)) throw new Error("Invalid manifest");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function diagnose(options) {
  const root = resolve2(options.root);
  const home = resolve2(options.home ?? homedir());
  const manifests = await Promise.all(["project", "global"].map(async (scope) => ({
    scope,
    manifest: await readManifest(getManifestPath(scope, root, home))
  })));
  const codexConfig = await readTarget(join2(home, ".codex/config.toml"));
  const userOwnsCodexNotify = codexConfig !== void 0 && hasTopLevelTomlKey(codexConfig.toString("utf8"), "notify");
  const detect = options.detectBinary ?? binaryOnPath;
  const native = await nativeIntegrations(home, options.env ?? {});
  return Promise.all(CLI_IDS.map(async (cli) => {
    const notes = cli === "agy" ? ["agy MCP: manual step"] : [];
    if (cli === "codex" && userOwnsCodexNotify) notes.push("A user-owned top-level Codex notify command is preserved; Edu did not add its notify hook.");
    const scopes = [];
    let drift = false;
    for (const { scope, manifest } of manifests) {
      const actions = manifest?.actions.filter((action) => (action.clis ?? [action.cli]).includes(cli)) ?? [];
      if (!actions.length) continue;
      scopes.push(scope);
      for (const action of actions) {
        const content = await readTarget(action.path);
        if (!content || !action.sha256 || sha256(content) !== action.sha256) drift = true;
      }
    }
    if (drift) notes.push("Edu-managed files differ from the manifest");
    notes.push(...native[cli].notes);
    return { cli, installed: await detect(cli), integrated: scopes.length > 0 || native[cli].found.length > 0, drift, scopes, native: native[cli].found, notes };
  }));
}

export {
  diagnose
};
//# sourceMappingURL=chunk-MJ7DE43X.js.map