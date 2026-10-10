import {
  agentTemplates,
  binaryOnPath,
  instructionActions,
  pathsFor,
  skillActions
} from "./chunk-ROTDA577.js";
import {
  eduMcpLaunch
} from "./chunk-FEHCOPF2.js";

// src/adapters/blocks.ts
var BLOCK_START = "<!-- edu:core:start -->";
var BLOCK_END = "<!-- edu:core:end -->";
function bounds(text) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start < 0 !== end < 0) throw new Error("Malformed Edu managed block");
  if (start < 0) return void 0;
  if (end < start || text.indexOf(BLOCK_START, start + BLOCK_START.length) >= 0 || text.indexOf(BLOCK_END, end + BLOCK_END.length) >= 0) {
    throw new Error("Malformed Edu managed block");
  }
  return [start, end + BLOCK_END.length];
}
function upsertManagedBlock(text, body) {
  const block = `${BLOCK_START}
${body.trimEnd()}
${BLOCK_END}`;
  const span = bounds(text);
  if (span) return text.slice(0, span[0]) + block + text.slice(span[1]);
  const separator = text.length === 0 ? "" : "\n";
  return `${text}${separator}${block}
`;
}
function removeManagedBlock(text) {
  const span = bounds(text);
  if (!span) return text;
  const [start, end] = span;
  if (end === text.length - 1 && text[end] === "\n") {
    const prefix = text.slice(0, start);
    return prefix.endsWith("\n") ? prefix.slice(0, -1) : prefix;
  }
  return text.slice(0, start) + text.slice(end);
}

// src/adapters/merge.ts
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseJson(text) {
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!record(parsed)) throw new Error("Expected a JSON object");
  return parsed;
}
function serialize(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
function isEduHook(value) {
  return record(value) && (value.command === "edu hook session-start" || value.command === "edu hook session-end");
}
function isEduEntry(value) {
  return record(value) && (value.edu === true || value.matcher === "edu" || Array.isArray(value.hooks) && value.hooks.some(isEduHook));
}
function withoutEduEntry(value) {
  if (!record(value)) return value;
  if (Array.isArray(value.hooks)) {
    const hooks = value.hooks.filter((hook) => !isEduHook(hook));
    if (hooks.length !== value.hooks.length) return hooks.length ? { ...value, hooks } : void 0;
  }
  return isEduEntry(value) ? void 0 : value;
}
function applyPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      if (value.every(isEduEntry)) {
        const prior = Array.isArray(target[key]) ? target[key] : [];
        target[key] = [...prior.map(withoutEduEntry).filter((entry) => entry !== void 0), ...value];
      } else {
        target[key] = value;
      }
    } else if (record(value)) {
      const prior = record(target[key]) ? target[key] : {};
      applyPatch(prior, value);
      target[key] = prior;
    } else {
      target[key] = value;
    }
  }
}
function removePatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target)) continue;
    if (Array.isArray(value) && Array.isArray(target[key])) {
      if (value.every(isEduEntry)) {
        const remaining = target[key].map(withoutEduEntry).filter((entry) => entry !== void 0);
        if (remaining.length) target[key] = remaining;
        else delete target[key];
      } else {
        delete target[key];
      }
    } else if (record(value) && record(target[key])) {
      removePatch(target[key], value);
      if (!Object.keys(target[key]).length) delete target[key];
    } else {
      delete target[key];
    }
  }
}
function mergeJson(text, patch) {
  const target = parseJson(text);
  applyPatch(target, patch);
  const result = serialize(target);
  return JSON.stringify(parseJson(text)) === JSON.stringify(target) ? text : result;
}
function unmergeJson(text, patch) {
  const target = parseJson(text);
  removePatch(target, patch);
  const result = serialize(target);
  return JSON.stringify(parseJson(text)) === JSON.stringify(target) ? text : result;
}
var TOML_START = "# edu:start";
var TOML_END = "# edu:end";
var TOML_TOP_START = "# edu:top:start";
var TOML_TOP_END = "# edu:top:end";
function markerBounds(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 !== end < 0) throw new Error("Malformed Edu TOML section");
  if (start < 0) return void 0;
  if (end < start || text.indexOf(startMarker, start + startMarker.length) >= 0 || text.indexOf(endMarker, end + endMarker.length) >= 0) throw new Error("Malformed Edu TOML section");
  return [start, end + endMarker.length];
}
var tomlBounds = (text) => markerBounds(text, TOML_START, TOML_END);
var tomlTopBounds = (text) => markerBounds(text, TOML_TOP_START, TOML_TOP_END);
function splitTopLevel(body) {
  const lines = body.trim().split(/\r?\n/);
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const cut = firstTable < 0 ? lines.length : firstTable;
  return { top: lines.slice(0, cut).join("\n").trim(), tables: lines.slice(cut).join("\n").trim() };
}
function removeTopSection(text) {
  const span = tomlTopBounds(text);
  if (!span) return text;
  const [start, end] = span;
  return text.slice(0, start) + text.slice(text[end] === "\n" ? end + 1 : end);
}
function mergeToml(text, body) {
  const prior = unmergeToml(text);
  let { top, tables } = splitTopLevel(body);
  if (hasTopLevelTomlKey(prior, "notify")) {
    top = top.split(/\r?\n/).filter((line) => !/^\s*notify\s*=/.test(line)).join("\n").trim();
  }
  let result = removeTopSection(text);
  if (tables) {
    const section = `${TOML_START}
${tables}
${TOML_END}`;
    const span = tomlBounds(result);
    if (span) result = result.slice(0, span[0]) + section + result.slice(span[1]);
    else {
      if (/^\s*\[mcp_servers\.edu\]\s*$/m.test(result)) throw new Error("Unmanaged Edu MCP TOML section already exists");
      result = `${result}${result ? "\n" : ""}${section}
`;
    }
  }
  if (top) result = `${TOML_TOP_START}
${top}
${TOML_TOP_END}
${result}`;
  return result;
}
function hasTopLevelTomlKey(text, key) {
  const unmanaged = unmergeToml(text);
  let topLevel = true;
  for (const line of unmanaged.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\[\[?.*\]\]?$/.test(trimmed)) {
      topLevel = false;
      continue;
    }
    if (topLevel && new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`).test(trimmed)) return true;
  }
  return false;
}
function unmergeToml(input) {
  const text = removeTopSection(input);
  const span = tomlBounds(text);
  if (!span) return text;
  const [start, end] = span;
  if (end === text.length - 1 && text[end] === "\n") {
    const prefix = text.slice(0, start);
    return prefix.endsWith("\n") ? prefix.slice(0, -1) : prefix;
  }
  return text.slice(0, start) + text.slice(end);
}

// src/adapters/claude.ts
import { readFile as readFile2 } from "fs/promises";
import { join as join2 } from "path";

// src/adapters/operations.ts
import { createHash } from "crypto";
import { access, lstat, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
async function readTarget(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(`Refusing non-regular target: ${path}`);
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
function materialize(action, before) {
  const text = before?.toString("utf8") ?? "";
  switch (action.kind) {
    case "managed-block":
      return Buffer.from(upsertManagedBlock(text, action.content ?? ""), "utf8");
    case "file":
      return Buffer.from(action.content ?? "", "utf8");
    case "json-merge":
      return Buffer.from(mergeJson(text, action.jsonPatch ?? {}), "utf8");
    case "toml-merge":
      return Buffer.from(mergeToml(text, action.tomlBody ?? ""), "utf8");
    default:
      throw new Error(`Unsupported action kind: ${action.kind}`);
  }
}
async function ensureParents(path, createdDirs) {
  const missing = [];
  let dir = dirname(path);
  while (true) {
    try {
      await access(dir);
      break;
    } catch {
      missing.push(dir);
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`No existing ancestor for ${path}`);
      dir = parent;
    }
  }
  for (const next of missing.reverse()) {
    await mkdir(next);
    if (!createdDirs.includes(next)) createdDirs.push(next);
  }
}
async function applyStandaloneActions(actions, home) {
  const result = [];
  const created = [];
  for (const [index, action] of actions.entries()) {
    const before = await readTarget(action.path);
    const after = materialize(action, before);
    if (before?.equals(after)) continue;
    let backup;
    if (before !== void 0) {
      backup = join(home, ".edu/backups", `standalone-${Date.now()}`, `${index}-${sha256(action.path)}`);
      await ensureParents(backup, created);
      await writeFile(backup, before);
    }
    await ensureParents(action.path, created);
    await writeFile(action.path, after);
    result.push({ cli: action.cli, kind: action.kind, path: action.path, description: action.description, sha256: sha256(after), backup });
  }
  return result;
}

// src/adapters/integration.ts
function createIntegration(cli, options, planner) {
  return {
    cli,
    detect: () => (options.detectBinary ?? binaryOnPath)(cli === "agy" ? "agy" : cli),
    plan: (scope, root) => planner(scope, root, options),
    apply: async (actions) => applyStandaloneActions(actions, options.home)
  };
}

// src/adapters/claude.ts
async function plan(scope, root, options) {
  const paths = pathsFor("claude", scope, root, options.home);
  const actions = [...instructionActions("claude", scope, root, options), ...await skillActions("claude", scope, root, options)];
  for (const agent of await agentTemplates(options.templatesDir)) {
    const header = `---
name: ${agent.name}
description: ${JSON.stringify(agent.description)}
tools: ${agent.tools}
---
`;
    actions.push({ cli: "claude", kind: "file", path: join2(paths.agents, `${agent.name}.md`), description: `Install ${agent.name} subagent`, content: `${header}
${agent.prompt}
` });
  }
  actions.push({ cli: "claude", kind: "json-merge", path: paths.mcp, description: "Register Edu MCP server", jsonPatch: { mcpServers: { edu: { ...eduMcpLaunch() } } } });
  const identityPath = join2(scope === "project" ? root : options.home, ".edu/EDU.md");
  const identity = await readFile2(identityPath, "utf8").catch(() => readFile2(join2(options.templatesDir, "EDU.md"), "utf8"));
  const voice = identity.match(/\*\*Voice\.\*\*[\s\S]*?(?=\n\n|$)/)?.[0] ?? "Direct, warm, evidence-first.";
  actions.push({ cli: "claude", kind: "file", path: paths.outputStyle, description: "Install Edu output style", content: `# Edu output style

${voice}
` });
  actions.push({ cli: "claude", kind: "json-merge", path: paths.settings, description: "Register Edu statusline and lifecycle hooks", jsonPatch: {
    statusLine: { type: "command", command: "edu statusline" },
    hooks: {
      SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "edu hook session-start" }] }],
      SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: "edu hook session-end" }] }]
    }
  } });
  return actions;
}
function createClaudeIntegration(options) {
  return createIntegration("claude", options, plan);
}

// src/adapters/codex.ts
async function plan2(scope, root, options) {
  const paths = pathsFor("codex", scope, root, options.home);
  return [
    ...instructionActions("codex", scope, root, options),
    ...await skillActions("codex", scope, root, options),
    { cli: "codex", kind: "toml-merge", path: paths.mcp, description: "Register Edu MCP server and Codex notify hook", tomlBody: `notify = ["edu", "hook", "codex-notify"]

[mcp_servers.edu]
command = ${JSON.stringify(eduMcpLaunch().command)}
args = ${JSON.stringify(eduMcpLaunch().args)}` }
  ];
}
function createCodexIntegration(options) {
  return createIntegration("codex", options, plan2);
}

// src/adapters/pi.ts
async function plan3(scope, root, options) {
  const paths = pathsFor("pi", scope, root, options.home);
  return [
    ...instructionActions("pi", scope, root, options),
    ...await skillActions("pi", scope, root, options),
    { cli: "pi", kind: "json-merge", path: paths.mcp, description: "Register Edu MCP server", jsonPatch: { mcpServers: { edu: { ...eduMcpLaunch() } } } }
  ];
}
function createPiIntegration(options) {
  return createIntegration("pi", options, plan3);
}

// src/adapters/opencode.ts
async function plan4(scope, root, options) {
  const paths = pathsFor("opencode", scope, root, options.home);
  const agents = {};
  for (const agent of await agentTemplates(options.templatesDir)) {
    agents[agent.name] = { description: agent.description, prompt: agent.prompt, mode: "subagent" };
  }
  return [
    ...instructionActions("opencode", scope, root, options),
    ...await skillActions("opencode", scope, root, options),
    { cli: "opencode", kind: "json-merge", path: paths.mcp, description: "Register Edu MCP server and agents", jsonPatch: { mcp: { edu: { type: "local", command: [eduMcpLaunch().command, ...eduMcpLaunch().args], enabled: true } }, agent: agents } }
  ];
}
function createOpenCodeIntegration(options) {
  return createIntegration("opencode", options, plan4);
}

// src/adapters/agy.ts
async function plan5(scope, root, options) {
  return [...instructionActions("agy", scope, root, options), ...await skillActions("agy", scope, root, options)];
}
function createAgyIntegration(options) {
  return createIntegration("agy", options, plan5);
}

// src/adapters/installer.ts
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { readFile as readFile3, rename, rmdir, unlink, writeFile as writeFile2 } from "fs/promises";
import { homedir } from "os";
import { basename, dirname as dirname2, isAbsolute, join as join3, resolve } from "path";
import { fileURLToPath } from "url";

// src/adapters/types.ts
var CLI_IDS = ["claude", "codex", "pi", "opencode", "agy"];

// src/adapters/installer.ts
function sharedRegistryPath(home) {
  return join3(home, ".edu/shared-targets.json");
}
function isSharedTarget(path, home) {
  return path === join3(home, ".codex/config.toml") || path === join3(home, ".pi/agent/mcp.json");
}
async function loadSharedRegistry(home) {
  const path = sharedRegistryPath(home);
  const content = await readTarget(path);
  if (!content) return { version: 1, targets: {}, createdDirs: [] };
  const value = JSON.parse(content.toString("utf8"));
  if (!value || typeof value !== "object" || value.version !== 1 || !value.targets || !Array.isArray(value.createdDirs)) {
    throw new Error(`Invalid Edu shared-target registry: ${path}`);
  }
  return value;
}
async function saveSharedRegistry(home, registry) {
  const path = sharedRegistryPath(home);
  if (!Object.keys(registry.targets).length) {
    await unlink(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  await ensureParents(path, registry.createdDirs);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile2(temp, `${JSON.stringify(registry, null, 2)}
`);
  await rename(temp, path);
}
function resolveTemplatesDir() {
  let dir = dirname2(fileURLToPath(import.meta.url));
  while (true) {
    const packagePath = join3(dir, "package.json");
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
        if (pkg.name === "edu-agent") return join3(dir, "templates");
      } catch {
      }
    }
    const parent = dirname2(dir);
    if (parent === dir) throw new Error("Could not locate edu-agent package root");
    dir = parent;
  }
}
function getManifestPath(scope, root, home) {
  return join3(scope === "project" ? root : home, ".edu/manifest.json");
}
async function planInstall(options) {
  const root = resolve(options.root);
  const home = resolve(options.home ?? homedir());
  const templatesDir = resolve(options.templatesDir ?? resolveTemplatesDir());
  const clis = options.clis === "all" ? CLI_IDS : [...new Set(options.clis)];
  for (const cli of clis) if (!CLI_IDS.includes(cli)) throw new Error(`Unknown CLI: ${cli}`);
  const settings = { home, templatesDir };
  const integrations = {
    claude: createClaudeIntegration(settings),
    codex: createCodexIntegration(settings),
    pi: createPiIntegration(settings),
    opencode: createOpenCodeIntegration(settings),
    agy: createAgyIntegration(settings)
  };
  const actions = [];
  const seen = /* @__PURE__ */ new Map();
  for (const cli of clis) {
    for (const action of await integrations[cli].plan(options.scope, root)) {
      if (!isAbsolute(action.path)) throw new Error(`Non-absolute target: ${action.path}`);
      const key = `${action.kind}:${action.path}`;
      const prior = seen.get(key);
      if (prior) {
        if (JSON.stringify({ content: prior.content, jsonPatch: prior.jsonPatch, tomlBody: prior.tomlBody }) !== JSON.stringify({ content: action.content, jsonPatch: action.jsonPatch, tomlBody: action.tomlBody })) {
          throw new Error(`Conflicting shared action: ${action.path}`);
        }
        prior.clis = [.../* @__PURE__ */ new Set([...prior.clis ?? [prior.cli], action.cli])];
        continue;
      }
      seen.set(key, action);
      actions.push(action);
    }
  }
  return { scope: options.scope, root, home, templatesDir, actions, notes: clis.includes("agy") ? ["agy MCP: manual step"] : [] };
}
function describePlan(plan6) {
  return [
    `Edu ${plan6.scope} installation: ${plan6.actions.length} file actions`,
    ...plan6.actions.map((action) => `- ${action.cli}: ${action.description} \u2192 ${action.path}`),
    ...plan6.notes.map((note) => `Note: ${note}`)
  ].join("\n");
}
async function loadManifest(path) {
  const content = await readTarget(path);
  if (!content) return void 0;
  const value = JSON.parse(content.toString("utf8"));
  if (!value || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.actions)) {
    throw new Error(`Invalid Edu manifest: ${path}`);
  }
  return value;
}
function publicAction(action, hash, backup, shared = false) {
  return { cli: action.cli, clis: action.clis ?? [action.cli], kind: action.kind, path: action.path, description: action.description, sha256: hash, ...backup ? { backup } : {}, ...shared ? { shared: true } : {}, ...action.jsonPatch ? { jsonPatch: action.jsonPatch } : {}, ...action.tomlBody ? { tomlBody: action.tomlBody } : {} };
}
async function applyInstall(plan6) {
  const manifestPath = getManifestPath(plan6.scope, plan6.root, plan6.home);
  const previous = await loadManifest(manifestPath);
  if (previous && previous.scope !== plan6.scope) throw new Error("Existing manifest has a different scope");
  const shared = await loadSharedRegistry(plan6.home);
  const otherScope = plan6.scope === "project" ? "global" : "project";
  const otherPath = getManifestPath(otherScope, plan6.root, plan6.home);
  if (otherPath !== manifestPath) {
    const other = await loadManifest(otherPath);
    const otherTargets = new Set(other?.actions.map((action) => action.path) ?? []);
    const conflict = plan6.actions.find((action) => otherTargets.has(action.path) && (!isSharedTarget(action.path, plan6.home) || !shared.targets[action.path]));
    if (conflict) throw new Error(`Target already managed by ${otherScope} installation: ${conflict.path}`);
  }
  const existing = new Map((previous?.actions ?? []).map((action) => [`${action.kind}:${action.path}`, action]));
  for (const action of previous?.actions ?? []) {
    const current = await readTarget(action.path);
    if (!current || !action.sha256 || sha256(current) !== action.sha256) throw new Error(`Edu installation drift: ${action.path}`);
    if (action.shared && !shared.targets[action.path]?.owners.includes(manifestPath)) throw new Error(`Missing shared ownership: ${action.path}`);
  }
  const paths = /* @__PURE__ */ new Set();
  const prepared = await Promise.all(plan6.actions.map(async (action) => {
    if (paths.has(action.path)) throw new Error(`Multiple operations target ${action.path}`);
    paths.add(action.path);
    const before = await readTarget(action.path);
    const after = materialize(action, before);
    const owner = shared.targets[action.path];
    if (isSharedTarget(action.path, plan6.home) && owner) {
      if (!before || sha256(before) !== owner.sha256) throw new Error(`Edu installation drift: ${action.path}`);
      if (sha256(after) !== owner.sha256 && owner.owners.some((path) => path !== manifestPath)) {
        throw new Error(`Shared target has another owner: ${action.path}`);
      }
    }
    return { action, before, after, prior: existing.get(`${action.kind}:${action.path}`) };
  }));
  const packageFile = join3(dirname2(resolveTemplatesDir()), "package.json");
  const pkg = JSON.parse(await readFile3(packageFile, "utf8"));
  const createdDirs = [...previous?.createdDirs ?? []];
  const nextActions = [...previous?.actions ?? []];
  const backupStamp = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const legacyBackups = [];
  let sharedChanged = false;
  for (const [index, { action, before, after, prior }] of prepared.entries()) {
    const key = `${action.kind}:${action.path}`;
    if (isSharedTarget(action.path, plan6.home)) {
      let target = shared.targets[action.path];
      if (!target && before?.equals(after) && !prior) throw new Error(`Untracked shared Edu target: ${action.path}`);
      if (!target) {
        let backup2;
        if (prior?.backup) {
          backup2 = join3(plan6.home, ".edu/shared-backups", `${backupStamp}-${index}-${basename(action.path)}`);
          await ensureParents(backup2, shared.createdDirs);
          await writeFile2(backup2, await readFile3(prior.backup));
          legacyBackups.push(prior.backup);
        } else if (before) {
          backup2 = join3(plan6.home, ".edu/shared-backups", `${backupStamp}-${index}-${basename(action.path)}`);
          await ensureParents(backup2, shared.createdDirs);
          await writeFile2(backup2, before);
        }
        target = { sha256: sha256(after), owners: [], ...backup2 ? { backup: backup2 } : {} };
        shared.targets[action.path] = target;
      }
      if (!before?.equals(after)) {
        await ensureParents(action.path, shared.createdDirs);
        await writeFile2(action.path, after);
        target.sha256 = sha256(after);
      }
      if (!target.owners.includes(manifestPath)) target.owners.push(manifestPath);
      const owners2 = [.../* @__PURE__ */ new Set([...prior?.clis ?? (prior ? [prior.cli] : []), ...action.clis ?? [action.cli]])];
      const saved2 = publicAction({ ...action, clis: owners2 }, target.sha256, target.backup, true);
      const oldIndex2 = nextActions.findIndex((item) => `${item.kind}:${item.path}` === key);
      if (oldIndex2 >= 0) nextActions[oldIndex2] = saved2;
      else nextActions.push(saved2);
      sharedChanged = true;
      continue;
    }
    if (before?.equals(after)) {
      if (prior) {
        const oldIndex2 = nextActions.findIndex((item) => `${item.kind}:${item.path}` === key);
        nextActions[oldIndex2] = { ...prior, clis: [.../* @__PURE__ */ new Set([...prior.clis ?? [prior.cli], ...action.clis ?? [action.cli]])] };
      }
      continue;
    }
    let backup = prior?.backup;
    if (before && !prior) {
      backup = join3(dirname2(manifestPath), "backups", backupStamp, `${index}-${basename(action.path)}`);
      await ensureParents(backup, createdDirs);
      await writeFile2(backup, before);
    }
    await ensureParents(action.path, createdDirs);
    await writeFile2(action.path, after);
    const owners = [.../* @__PURE__ */ new Set([...prior?.clis ?? (prior ? [prior.cli] : []), ...action.clis ?? [action.cli]])];
    const saved = publicAction({ ...action, clis: owners }, sha256(after), backup);
    const oldIndex = nextActions.findIndex((item) => `${item.kind}:${item.path}` === key);
    if (oldIndex >= 0) nextActions[oldIndex] = saved;
    else nextActions.push(saved);
  }
  const manifest = {
    version: 1,
    eduVersion: pkg.version,
    installedAt: previous?.installedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    scope: plan6.scope,
    actions: nextActions,
    createdDirs,
    home: plan6.home
  };
  await ensureParents(manifestPath, createdDirs);
  manifest.createdDirs = createdDirs;
  if (sharedChanged) await saveSharedRegistry(plan6.home, shared);
  const temp = `${manifestPath}.${randomUUID()}.tmp`;
  await writeFile2(temp, `${JSON.stringify(manifest, null, 2)}
`);
  await rename(temp, manifestPath);
  for (const backup of legacyBackups) await unlink(backup);
  return manifest;
}
async function uninstall(options) {
  const manifest = await loadManifest(options.manifestPath);
  if (!manifest) throw new Error(`Edu manifest not found: ${options.manifestPath}`);
  if (options.force) {
    for (const action of manifest.actions) {
      if (action.kind !== "json-merge" || action.jsonPatch) continue;
      const current = await readTarget(action.path);
      if (!current || !action.sha256 || sha256(current) !== action.sha256) {
        throw new Error(`Cannot safely force-uninstall legacy JSON merge without ownership metadata: ${action.path}`);
      }
    }
  }
  const shared = manifest.home ? await loadSharedRegistry(manifest.home) : void 0;
  for (const action of manifest.actions.filter((action2) => action2.shared)) {
    if (!shared?.targets[action.path]?.owners.includes(options.manifestPath)) {
      throw new Error(`Missing shared ownership: ${action.path}`);
    }
  }
  if (!options.force) {
    for (const action of manifest.actions) {
      const current = await readTarget(action.path);
      if (!current || !action.sha256 || sha256(current) !== action.sha256) throw new Error(`Edu installation drift: ${action.path}`);
    }
  }
  const sharedBackups = [];
  let sharedChanged = false;
  for (const action of [...manifest.actions].reverse()) {
    if (action.shared) {
      const target = shared.targets[action.path];
      target.owners = target.owners.filter((owner) => owner !== options.manifestPath);
      if (!target.owners.length) {
        const current2 = await readTarget(action.path);
        if (current2 && action.kind === "json-merge" && action.jsonPatch) {
          const remaining = unmergeJson(current2.toString("utf8"), action.jsonPatch);
          if (!options.force && target.backup) await writeFile2(action.path, await readFile3(target.backup));
          else if (options.force && target.backup) await writeFile2(action.path, remaining);
          else if (isEmptyJson(remaining)) await unlink(action.path).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
          else await writeFile2(action.path, remaining);
          if (!options.force && target.backup) sharedBackups.push(target.backup);
        } else if (current2 && action.kind === "toml-merge") {
          const remaining = unmergeToml(current2.toString("utf8"));
          if (!options.force && target.backup) await writeFile2(action.path, await readFile3(target.backup));
          else if (options.force && target.backup) await writeFile2(action.path, remaining);
          else if (!remaining.trim()) await unlink(action.path).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
          else await writeFile2(action.path, remaining);
          if (!options.force && target.backup) sharedBackups.push(target.backup);
        } else if (current2 && action.kind === "managed-block") {
          const remaining = removeManagedBlock(current2.toString("utf8"));
          if (options.force && target.backup) await writeFile2(action.path, remaining);
          else if (!remaining.trim()) await unlink(action.path).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
          else await writeFile2(action.path, remaining);
        } else if (target.backup) {
          await writeFile2(action.path, await readFile3(target.backup));
          sharedBackups.push(target.backup);
        } else {
          await unlink(action.path).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
        delete shared.targets[action.path];
      }
      sharedChanged = true;
      continue;
    }
    const current = await readTarget(action.path);
    if (!options.force && action.backup) {
      await writeFile2(action.path, await readFile3(action.backup));
    } else if (action.kind === "managed-block" && current) {
      const remaining = removeManagedBlock(current.toString("utf8"));
      if (!remaining.trim() && options.force && action.backup) await writeFile2(action.path, remaining);
      else if (!remaining.trim()) await unlink(action.path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      else await writeFile2(action.path, remaining);
    } else if (action.kind === "json-merge" && current && action.jsonPatch) {
      const remaining = unmergeJson(current.toString("utf8"), action.jsonPatch);
      if (options.force && action.backup) await writeFile2(action.path, remaining);
      else if (isEmptyJson(remaining)) await unlink(action.path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      else await writeFile2(action.path, remaining);
    } else if (action.kind === "toml-merge" && current) {
      const remaining = unmergeToml(current.toString("utf8"));
      if (options.force && action.backup) await writeFile2(action.path, remaining);
      else if (!remaining.trim()) await unlink(action.path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      else await writeFile2(action.path, remaining);
    } else if (action.backup) {
      const original = await readFile3(action.backup);
      await writeFile2(action.path, original);
    } else {
      await unlink(action.path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  for (const backup of manifest.actions.filter((action) => !action.shared).map((action) => action.backup).filter((value) => !!value)) await unlink(backup);
  await unlink(options.manifestPath);
  if (sharedChanged) {
    await saveSharedRegistry(manifest.home, shared);
    for (const backup of sharedBackups) await unlink(backup);
  }
  for (const dir of [...manifest.createdDirs ?? []].reverse()) {
    await rmdir(dir).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
    });
  }
  if (sharedChanged && !Object.keys(shared.targets).length) {
    for (const dir of [...shared.createdDirs].reverse()) {
      await rmdir(dir).catch((error) => {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
      });
    }
  }
}
function isEmptyJson(value) {
  try {
    return Object.keys(JSON.parse(value)).length === 0;
  } catch {
    return false;
  }
}

export {
  upsertManagedBlock,
  removeManagedBlock,
  mergeJson,
  unmergeJson,
  mergeToml,
  hasTopLevelTomlKey,
  unmergeToml,
  sha256,
  readTarget,
  createClaudeIntegration,
  createCodexIntegration,
  createPiIntegration,
  createOpenCodeIntegration,
  createAgyIntegration,
  CLI_IDS,
  resolveTemplatesDir,
  getManifestPath,
  planInstall,
  describePlan,
  applyInstall,
  uninstall
};
//# sourceMappingURL=chunk-33ZZBVGB.js.map