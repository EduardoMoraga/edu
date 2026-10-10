import {
  initBrain
} from "./chunk-PYSJJP4V.js";
import {
  UNION,
  applyInstall,
  getManifestPath,
  planInstall,
  uninstall
} from "./chunk-NO3RXWHL.js";
import {
  instructionActions
} from "./chunk-ROTDA577.js";
import {
  eduMcpLaunch,
  spawnCli
} from "./chunk-B5FNIIOI.js";

// src/setup/index.ts
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { parse as parse2 } from "jsonc-parser";

// src/detach/edit.ts
import { applyEdits, findNodeAtLocation, modify, parse, parseTree } from "jsonc-parser";

// src/detach/signatures.ts
var TOOL_IDS = ["gentle-ai", "engram", "moragent", "orca", "axi", "codegraph", "herdr", "hermes", "edu"];
var SIGNATURES = {
  "gentle-ai": { marker: "gentle-ai", commands: ["gentle-ai", "gentle-shell"], mcp: [], plugins: ["gentle-ai", "gentle-logo"], packages: ["gentle-pi"], extras: { claudeOutputStyle: "Gentleman", opencodeDefaultAgent: "gentle-orchestrator" }, memoryWriter: false, orchestrator: true, keepSections: { persona: ["Rules", "Expertise"] } },
  engram: { marker: "engram", commands: ["engram"], mcp: ["engram"], plugins: ["engram"], packages: ["gentle-engram"], extras: { codexInstructionKeys: ["model_instructions_file", "experimental_compact_prompt_file"] }, memoryWriter: true, orchestrator: false },
  moragent: { marker: "moragent", commands: ["mora ", "moragent"], mcp: ["moragent"], plugins: ["moragent"], packages: ["moragent"], memoryWriter: true, orchestrator: true },
  orca: { marker: "orca", commands: ["orca"], mcp: ["orca"], plugins: ["orca"], packages: ["orca"], memoryWriter: false, orchestrator: false },
  axi: { marker: "axi", commands: ["-axi"], mcp: [], plugins: ["axi"], packages: ["axi"], memoryWriter: false, orchestrator: false },
  codegraph: { marker: "codegraph", commands: ["codegraph"], mcp: ["codegraph"], plugins: ["codegraph"], packages: ["codegraph"], memoryWriter: false, orchestrator: false },
  herdr: { marker: "herdr", commands: ["herdr"], mcp: ["herdr"], plugins: ["herdr"], packages: ["herdr"], memoryWriter: false, orchestrator: false },
  hermes: { marker: "hermes", commands: ["hermes"], mcp: ["hermes"], plugins: ["hermes"], packages: ["hermes"], memoryWriter: false, orchestrator: false },
  edu: { marker: "edu", commands: ["edu "], mcp: ["edu"], plugins: ["edu"], packages: ["edu"], memoryWriter: true, orchestrator: true }
};
function ownerOf(value, field) {
  const lower = value.toLowerCase();
  return TOOL_IDS.find((id) => SIGNATURES[id][field].some((part) => field === "mcp" ? lower === part : lower.includes(part) || field === "commands" && lower === part.trim()));
}
function assertDetachable(ids) {
  if (ids.includes("edu")) throw new Error("Edu cannot detach itself.");
  const unknown = ids.filter((id) => !TOOL_IDS.includes(id));
  if (unknown.length) throw new Error(`Unknown tool: ${unknown.join(", ")}`);
  return [...new Set(ids)];
}

// src/detach/edit.ts
var selected = (value, field, tools) => {
  const owner = ownerOf(value, field);
  return owner !== void 0 && tools.includes(owner);
};
var pluginName = (value) => /[\\/]/.test(value) ? value.split(/[\\/]/).filter(Boolean).at(-1) ?? value : value;
function editInstructions(input, tools) {
  const marker = /<!--\s*(\/)?([\w-]+):([\w-]+)\s*-->/g;
  const stack = [];
  const spans = [];
  for (const match of input.matchAll(marker)) {
    const [token, close, owner, name] = match;
    const at = match.index;
    if (!close) {
      stack.push({ owner, name, start: at });
      continue;
    }
    const index = stack.findLastIndex((item) => item.owner === owner && item.name === name);
    if (index < 0) continue;
    const last = stack[index];
    stack.length = index;
    const tool = tools.find((id) => SIGNATURES[id].marker === owner);
    if (tool && !stack.some((item) => tools.some((id) => SIGNATURES[id].marker === item.owner))) {
      const body = input.slice(last.start + input.slice(last.start).indexOf("-->") + 3, at);
      spans.push({ start: last.start, end: at + token.length, keep: keptSections(body, SIGNATURES[tool].keepSections?.[name] ?? []) });
    }
  }
  let text = input;
  for (const { start, end, keep } of spans.sort((a, b) => b.start - a.start)) text = text.slice(0, start) + keep + text.slice(end);
  if (spans.length) text = text.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  return { text, changes: spans.map((span) => span.keep ? "instruction block (your sections kept)" : "instruction block") };
}
function keptSections(body, titles) {
  if (!titles.length) return "";
  const parts = body.split(/(?=^## )/m);
  const kept = parts.filter((part) => {
    const title = /^## (.+)$/m.exec(part)?.[1]?.trim();
    return title !== void 0 && titles.includes(title);
  });
  return kept.length ? `${kept.map((part) => part.trimEnd()).join("\n\n")}
` : "";
}
function commandOf(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record = value;
  if (typeof record.command === "string") return record.command;
  if (Array.isArray(record.command)) return record.command.filter((part) => typeof part === "string").join(" ");
  return void 0;
}
function pruneHooks(value, tools, changes) {
  if (Array.isArray(value)) {
    return value.map((item) => pruneHooks(item, tools, changes)).filter((item) => item !== void 0);
  }
  if (!value || typeof value !== "object") return value;
  const object = value;
  const command = commandOf(object);
  if (command && selected(command, "commands", tools)) {
    changes.push(`hook: ${ownerOf(command, "commands")}`);
    return void 0;
  }
  const result = { ...object };
  for (const [key, child] of Object.entries(object)) {
    if (key === "hooks" || key === "handlers" || Array.isArray(child)) {
      const next = pruneHooks(child, tools, changes);
      if (Array.isArray(next) && next.length === 0 && (key === "hooks" || key === "handlers")) return void 0;
      result[key] = next;
    }
  }
  return result;
}
function editObject(input, host, tools, changes) {
  const result = structuredClone(input);
  for (const key of ["mcpServers", "mcp_servers", "mcp"]) {
    const servers = result[key];
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) continue;
    for (const id of Object.keys(servers)) if (selected(id, "mcp", tools)) {
      delete servers[id];
      changes.push(`MCP: ${id}`);
    }
  }
  for (const key of ["enabledPlugins", "plugins", "plugin"]) {
    const plugins = result[key];
    if (plugins && typeof plugins === "object" && !Array.isArray(plugins)) {
      for (const id of Object.keys(plugins)) if (selected(id, "plugins", tools)) {
        delete plugins[id];
        changes.push(`plugin: ${id}`);
      }
    } else if (Array.isArray(plugins)) {
      result[key] = plugins.filter((item) => {
        const remove = typeof item === "string" && selected(pluginName(item), "plugins", tools);
        if (remove) changes.push(`plugin: ${pluginName(item)}`);
        return !remove;
      });
    }
  }
  if (host === "pi" && Array.isArray(result.packages)) {
    result.packages = result.packages.filter((item) => {
      const remove = typeof item === "string" && selected(item, "packages", tools);
      if (remove) changes.push(`package: ${item}`);
      return !remove;
    });
  }
  if (host === "claude") {
    if (tools.some((tool) => SIGNATURES[tool].extras?.claudeOutputStyle === result.outputStyle)) {
      delete result.outputStyle;
      changes.push("outputStyle");
    }
    const status = commandOf(result.statusLine);
    if (status && selected(status, "commands", tools)) {
      delete result.statusLine;
      changes.push("statusLine");
    }
  }
  if (host === "opencode" && tools.some((tool) => SIGNATURES[tool].extras?.opencodeDefaultAgent === result.default_agent)) {
    delete result.default_agent;
    changes.push("default_agent");
  }
  if (result.hooks) {
    const hooks = pruneHooks(result.hooks, tools, changes);
    result.hooks = hooks ?? {};
  }
  return result;
}
function jsonEdit(input, host, tools, jsonc) {
  const errors = [];
  const value = jsonc ? parse(input, errors, { allowTrailingComma: true }) : JSON.parse(input);
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid host configuration; refusing partial edit");
  const changes = [];
  const result = editObject(value, host, tools, changes);
  if (!changes.length) return { text: input, changes };
  if (!jsonc) return { text: `${JSON.stringify(result, null, 2)}
`, changes };
  let text = input;
  const before = value;
  for (const key of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(result)])) {
    const oldValue = before[key];
    const newValue = result[key];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      const removed = removedIndexes(oldValue, newValue);
      if (removed) {
        for (const index of removed.reverse()) text = removeArrayItem(text, [key, index]);
        continue;
      }
    }
    if (oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object" && !Array.isArray(oldValue) && !Array.isArray(newValue)) {
      const oldMap = oldValue;
      const newMap = newValue;
      for (const child of /* @__PURE__ */ new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
        if (JSON.stringify(oldMap[child]) === JSON.stringify(newMap[child])) continue;
        text = applyEdits(text, modify(text, [key, child], newMap[child], { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }));
      }
    } else {
      text = applyEdits(text, modify(text, [key], newValue, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }));
    }
  }
  return { text, changes };
}
function removeArrayItem(text, path) {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const node = root && findNodeAtLocation(root, path);
  if (!node) return text;
  let start = node.offset;
  let end = node.offset + node.length;
  const comma = /^[ \t]*,/.exec(text.slice(end));
  if (comma) end += comma[0].length;
  else {
    const previous = /,\s*$/.exec(text.slice(0, start));
    if (previous) start = previous.index;
  }
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline < 0 ? text.length : newline;
  if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) {
    start = lineStart;
    end = newline < 0 ? text.length : newline + 1;
  }
  return text.slice(0, start) + text.slice(end);
}
function removedIndexes(before, after) {
  const removed = [];
  let next = 0;
  before.forEach((item, index) => {
    if (next < after.length && JSON.stringify(after[next]) === JSON.stringify(item)) next++;
    else removed.push(index);
  });
  return next === after.length ? removed : void 0;
}
function bracketDepth(text) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (const c of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && c === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#") break;
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
  }
  return depth;
}
function tomlEdit(input, tools) {
  const lines = input.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const changes = [];
  const output = [];
  let section = "";
  let dropSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^\s*\[{1,2}(.+?)\]{1,2}\s*(?:#.*)?(?:\n)?$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      const plugin = /^plugins\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const mcp = /^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const market = /^marketplaces\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const id = plugin?.[1] || plugin?.[2] || plugin?.[3] || mcp?.[1] || mcp?.[2] || mcp?.[3] || market?.[1] || market?.[2] || market?.[3];
      dropSection = Boolean(id && selected(id, plugin || market ? "plugins" : "mcp", tools));
      if (dropSection) changes.push(`${plugin ? "plugin" : market ? "marketplace" : "MCP"}: ${id}`);
    }
    if (dropSection) continue;
    if (!section) {
      const key = /^\s*([\w-]+)\s*=\s*(.*?)(?:\n)?$/.exec(line);
      if (key) {
        const [statement] = key;
        let end = i;
        let depth = bracketDepth(statement);
        while (depth > 0 && end + 1 < lines.length) depth += bracketDepth(lines[++end]);
        const raw = lines.slice(i, end + 1).join("");
        const remove = tools.some((tool) => SIGNATURES[tool].extras?.codexInstructionKeys?.includes(key[1]) && raw.toLowerCase().includes(tool)) || key[1] === "notify" && tools.some((tool) => SIGNATURES[tool].commands.some((part) => raw.toLowerCase().includes(part)));
        if (remove) {
          changes.push(`config: ${key[1]}`);
          i = end;
          continue;
        }
      }
    }
    output.push(line);
  }
  return { text: output.join(""), changes };
}
function editContent(kind, host, input, tools) {
  if (kind === "instructions") return editInstructions(input, tools);
  if (kind === "toml") return tomlEdit(input, tools);
  return jsonEdit(input, host, tools, kind === "jsonc");
}

// src/setup/index.ts
var LIST_COMMANDS = {
  claude: { cli: "claude", command: "claude", args: ["plugin", "list"] },
  codex: { cli: "codex", command: "codex", args: ["plugin", "list", "--json"] },
  pi: { cli: "pi", command: "pi", args: ["list"] },
  opencode: { cli: "opencode", command: "opencode", args: ["mcp", "list"] },
  agy: { cli: "agy", command: "agy", args: ["plugin", "list"] }
};
var defaultRunner = ({ command, args }) => new Promise((resolveResult) => {
  const child = spawnCli(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(chunk));
  child.stderr?.on("data", (chunk) => stderr.push(chunk));
  child.once("error", (error) => resolveResult({ exitCode: 127, stderr: error.message }));
  child.once("close", (code) => resolveResult({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
});
function nativeCommands(cli, packageRoot) {
  switch (cli) {
    case "claude":
      return [
        { cli, command: "claude", args: ["plugin", "marketplace", "add", packageRoot] },
        { cli, command: "claude", args: ["plugin", "install", "edu@edu"] }
      ];
    case "codex":
      return [
        { cli, command: "codex", args: ["plugin", "marketplace", "add", packageRoot] },
        { cli, command: "codex", args: ["plugin", "add", "edu@edu"] }
      ];
    case "pi":
      return [{ cli, command: "pi", args: ["install", packageRoot] }];
    case "agy":
      return [{ cli, command: "agy", args: ["plugin", "install", join(packageRoot, "plugins/agy")] }];
    case "opencode":
      return [];
  }
}
function isCodexInstalledJson(stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    return false;
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.installed)) return false;
  return value.installed.some((entry) => {
    if (typeof entry === "string") return entry.toLowerCase() === "edu@edu";
    if (!entry || typeof entry !== "object") return false;
    const record = entry;
    const id = [record.id, record.pluginId, record.plugin_id, record.selector].find((item) => typeof item === "string");
    if (typeof id === "string" && id.toLowerCase() === "edu@edu") return true;
    const name = [record.name, record.plugin].find((item) => typeof item === "string");
    const marketplace = [record.marketplace, record.marketplaceName, record.marketplace_name].find((item) => typeof item === "string");
    return typeof name === "string" && name.toLowerCase() === "edu" && typeof marketplace === "string" && marketplace.toLowerCase() === "edu";
  });
}
function isInstalled(result, cli) {
  if (result.exitCode !== 0) return false;
  if (cli === "codex") return isCodexInstalledJson(result.stdout ?? "");
  const knownIds = /* @__PURE__ */ new Set(["edu", "edu@edu", "edu-agent"]);
  return (result.stdout ?? "").split(/\r?\n/).some((line) => {
    const first = line.trim().replace(/^[*•✓✔\s]+/, "").split(/\s+/)[0]?.toLowerCase();
    const leaf = first?.split(/[/:]/).at(-1)?.replace(/\.git$/, "");
    return leaf !== void 0 && knownIds.has(leaf);
  });
}
async function collectFiles(root, relative = "") {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, path));
    else if (entry.isFile()) files.push({ path, content: await readFile(join(root, path), "utf8") });
  }
  return files;
}
async function appendOpenCodeAssets(plan, packageRoot) {
  const sourceRoot = join(packageRoot, "plugins/opencode");
  const destinationRoot = join(plan.home, ".config/opencode");
  for (const category of ["commands", "agents", "plugins"]) {
    const source = join(sourceRoot, category);
    let files;
    try {
      files = await collectFiles(source);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Generated OpenCode ${category} are missing from ${sourceRoot}`);
      throw error;
    }
    if (!files.length) throw new Error(`Generated OpenCode ${category} are empty in ${sourceRoot}`);
    for (const file of files) {
      const action = {
        cli: "opencode",
        kind: "file",
        path: join(destinationRoot, category, file.path),
        description: `Install OpenCode ${category} file ${file.path}`,
        content: file.content
      };
      plan.actions.push(action);
    }
  }
  await appendOpenCodeTui(plan, sourceRoot, destinationRoot);
  retireOpenCode1Tui(plan, destinationRoot);
}
var OPENCODE1_TUI_PLUGIN = "tui-plugins/edu.tsx";
function retireOpenCode1Tui(plan, destinationRoot) {
  const stale = join(destinationRoot, OPENCODE1_TUI_PLUGIN);
  const jsonPatch = { plugin: { [UNION]: [stale] } };
  plan.retire = [
    ...plan.retire ?? [],
    { kind: "file", path: stale },
    { kind: "json-merge", path: join(destinationRoot, "tui.json"), jsonPatch },
    { kind: "json-merge", path: join(destinationRoot, "tui.jsonc"), jsonPatch }
  ];
}
async function removeOpenCode1TuiFromCliJson(home) {
  const destinationRoot = join(home, ".config/opencode");
  const path = join(destinationRoot, "cli.json");
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const errors = [];
  const value = parse2(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== "object" || !Array.isArray(value.plugins)) return;
  const stale = join(destinationRoot, OPENCODE1_TUI_PLUGIN);
  const indexes = value.plugins.flatMap((item, index) => item === stale ? [index] : []);
  if (!indexes.length) return;
  let next = text;
  for (const index of indexes.reverse()) next = removeArrayItem(next, ["plugins", index]);
  await writeFile(path, next);
}
var OPENCODE_TUI_PLUGIN = "plugins/edu-deck/tui.tsx";
async function appendOpenCodeTui(plan, sourceRoot, destinationRoot) {
  let tui;
  try {
    tui = await readFile(join(sourceRoot, "tui/edu.tsx"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  plan.actions.push({ cli: "opencode", kind: "file", path: join(destinationRoot, OPENCODE_TUI_PLUGIN), description: "Install the Edu Deck OpenCode TUI plugin", content: tui });
  try {
    const theme = await readFile(join(sourceRoot, "themes/edu.json"), "utf8");
    plan.actions.push({ cli: "opencode", kind: "file", path: join(destinationRoot, "themes/edu.json"), description: "Install the edu OpenCode theme", content: theme });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function planSetup(options) {
  const runner = options.runner ?? defaultRunner;
  const commands = [];
  const fallback = [];
  const alreadyInstalled = [];
  for (const cli of [...new Set(options.clis)]) {
    if (cli === "opencode") {
      fallback.push(cli);
      continue;
    }
    const listed = await runner(LIST_COMMANDS[cli]);
    if (isInstalled(listed, cli)) {
      alreadyInstalled.push(cli);
      continue;
    }
    commands.push(...nativeCommands(cli, resolve(options.packageRoot)));
  }
  return { ...options, packageRoot: resolve(options.packageRoot), home: resolve(options.home), commands, fallback, alreadyInstalled };
}
async function writeManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}
`);
  await rename(temp, path);
}
async function localizePluginsForPlatform(packageRoot, platform = process.platform, opts = {}) {
  if (platform !== "win32") return [];
  if ((opts.installedOnly ?? true) && !/[\\/]node_modules[\\/]/.test(packageRoot)) return [];
  const launch = eduMcpLaunch(platform);
  const targets = [
    ["plugins/claude-code/.mcp.json", (edu) => ({ edu })],
    ["plugins/codex/.mcp.json", (edu) => ({ mcpServers: { edu } })],
    ["plugins/agy/mcp_config.json", (edu) => ({ mcpServers: { edu } })]
  ];
  const written = [];
  for (const [relative, shape] of targets) {
    const path = join(packageRoot, relative);
    try {
      await access(path);
    } catch {
      continue;
    }
    await writeFile(path, `${JSON.stringify(shape(launch), null, 2)}
`);
    written.push(path);
  }
  return written;
}
async function applySetup(plan, options = {}) {
  const runner = options.runner ?? plan.runner ?? defaultRunner;
  const report = { installed: [], fallback: [], alreadyInstalled: [...plan.alreadyInstalled], failed: [] };
  const pending = new Set(plan.fallback);
  const successful = /* @__PURE__ */ new Set();
  const failed = /* @__PURE__ */ new Map();
  await localizePluginsForPlatform(plan.packageRoot, options.platform);
  if (plan.commands.some((c) => c.cli === "codex")) {
    const { mkdir: mkdir2 } = await import("fs/promises");
    await mkdir2(process.env.CODEX_HOME || join(plan.home, ".codex"), { recursive: true }).catch(() => void 0);
  }
  for (const command of plan.commands) {
    if (failed.has(command.cli)) continue;
    const result = await runner(command);
    if (result.exitCode !== 0) failed.set(command.cli, (result.stderr || result.stdout || `exit ${result.exitCode}`).trim());
    else successful.add(command.cli);
  }
  for (const [cli, message] of failed) {
    pending.add(cli);
    report.failed.push({ cli, message });
  }
  for (const cli of successful) if (!pending.has(cli)) report.installed.push(cli);
  let adapterPlan;
  if (pending.size) {
    adapterPlan = await planInstall({ clis: [...pending], scope: "global", root: plan.packageRoot, home: plan.home, templatesDir: options.templatesDir ?? join(plan.packageRoot, "templates") });
    if (pending.has("opencode")) await appendOpenCodeAssets(adapterPlan, plan.packageRoot);
    report.fallback.push(...pending);
  }
  const codexInstalled = successful.has("codex") || plan.alreadyInstalled.includes("codex");
  if (codexInstalled && !pending.has("codex")) {
    const templatesDir = options.templatesDir ?? join(plan.packageRoot, "templates");
    const identityActions = instructionActions("codex", "global", plan.packageRoot, { home: plan.home, templatesDir });
    if (adapterPlan) {
      adapterPlan.actions.push(...identityActions);
    } else {
      adapterPlan = {
        scope: "global",
        root: plan.packageRoot,
        home: plan.home,
        templatesDir,
        notes: [],
        actions: identityActions
      };
    }
  }
  let adapterManifestPath;
  if (adapterPlan) {
    await applyInstall(adapterPlan);
    adapterManifestPath = getManifestPath("global", plan.packageRoot, plan.home);
  }
  if (pending.has("opencode")) await removeOpenCode1TuiFromCliJson(plan.home);
  const brainRoot = resolve(options.brainRoot ?? process.env.EDU_HOME ?? join(plan.home, ".edu"));
  await initBrain({ location: { scope: "global", root: brainRoot }, templatesDir: options.templatesDir ?? join(plan.packageRoot, "templates"), detected: options.detected ?? plan.clis, lang: options.lang });
  const manifestPath = join(plan.home, ".edu/plugin-setup.json");
  let previous;
  try {
    previous = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = {
    version: 1,
    packageRoot: plan.packageRoot,
    native: [.../* @__PURE__ */ new Set([...previous?.native ?? [], ...report.installed])],
    fallback: [.../* @__PURE__ */ new Set([...previous?.fallback ?? [], ...report.fallback])],
    ...adapterManifestPath || previous?.adapterManifestPath ? { adapterManifestPath: adapterManifestPath ?? previous?.adapterManifestPath } : {}
  };
  await writeManifest(join(plan.home, ".edu/plugin-setup.json"), manifest);
  return report;
}
async function setupManifestPath(home) {
  return join(resolve(home), ".edu/plugin-setup.json");
}
async function uninstallSetup(options) {
  const path = await setupManifestPath(options.home);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const runner = options.runner ?? defaultRunner;
  const commands = {
    claude: () => [
      { cli: "claude", command: "claude", args: ["plugin", "uninstall", "edu@edu"] },
      { cli: "claude", command: "claude", args: ["plugin", "marketplace", "remove", "edu"] }
    ],
    codex: () => [
      { cli: "codex", command: "codex", args: ["plugin", "remove", "edu@edu"] },
      { cli: "codex", command: "codex", args: ["plugin", "marketplace", "remove", "edu"] }
    ],
    pi: (root) => [{ cli: "pi", command: "pi", args: ["remove", root] }],
    opencode: () => [],
    agy: () => [{ cli: "agy", command: "agy", args: ["plugin", "uninstall", "edu"] }]
  };
  const failures = [];
  for (const cli of manifest.native) {
    for (const command of commands[cli](manifest.packageRoot)) {
      try {
        const result = await runner(command);
        if (result.exitCode !== 0) failures.push(`${command.command} ${command.args.join(" ")} failed: ${result.stderr || result.stdout || result.exitCode}`);
      } catch (error) {
        failures.push(`${command.command} ${command.args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (manifest.adapterManifestPath) {
    try {
      await uninstall({ manifestPath: manifest.adapterManifestPath, force: options.force });
    } catch (error) {
      failures.push(`Managed adapter cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new AggregateError(failures, failures.join("\n"));
    }
  }
  await unlink(path);
  if (failures.length) throw new AggregateError(failures, failures.join("\n"));
}
async function needsFirstRunSetup(home) {
  try {
    await access(join(home, "config.json"));
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

export {
  TOOL_IDS,
  SIGNATURES,
  ownerOf,
  assertDetachable,
  editInstructions,
  editContent,
  OPENCODE_TUI_PLUGIN,
  planSetup,
  localizePluginsForPlatform,
  applySetup,
  setupManifestPath,
  uninstallSetup,
  needsFirstRunSetup
};
//# sourceMappingURL=chunk-SPL7O2VD.js.map