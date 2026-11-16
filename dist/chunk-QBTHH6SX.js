import {
  eolOf,
  managedBlock,
  managedBlockBody,
  removeManagedBlock,
  sectionDigest,
  upsertManagedBlock
} from "./chunk-BIXUCKST.js";
import {
  UnsupportedSkillEncodingError,
  UnsupportedSkillPathError,
  assertContained,
  canonicalAnchor,
  portablePath,
  readSkillBundle
} from "./chunk-6VKNJRFI.js";
import {
  retryFs,
  withFsRetry
} from "./chunk-AINX4RRX.js";
import {
  codexMcpEntry
} from "./chunk-6O2RRLWR.js";
import {
  binaryOnPath,
  eduMcpLaunch
} from "./chunk-KLV4TDB7.js";
import {
  packageTemplatesDir,
  packageVersion
} from "./chunk-NMJNTHQG.js";
import {
  CLI_IDS,
  parseFrontmatter
} from "./chunk-X74ZO2KX.js";

// src/adapters/paths.ts
import { join, resolve, sep } from "path";
function hostConfigDirs(home, env = {}, options = {}) {
  return {
    claude: resolve((options.claudeConfig ?? true) && env.CLAUDE_CONFIG_DIR || join(home, ".claude")),
    codex: resolve(env.CODEX_HOME || join(home, ".codex")),
    pi: resolve(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent")),
    opencode: resolve(home, ".config", "opencode"),
    gemini: resolve(home, ".gemini")
  };
}
var installDirs = (home, env = {}) => hostConfigDirs(home, env, { claudeConfig: false });
function pathsFor(cli, scope, root, home, dirs = installDirs(home)) {
  const project = scope === "project";
  const sharedSkills = join(project ? root : home, ".agents/skills");
  switch (cli) {
    case "claude": {
      const base = join(project ? root : home, ".claude");
      return {
        instructions: [join(project ? root : base, "CLAUDE.md")],
        skills: join(base, "skills"),
        agents: join(base, "agents"),
        mcp: join(project ? root : home, project ? ".mcp.json" : ".claude.json"),
        settings: join(base, "settings.json"),
        outputStyle: join(base, "output-styles/edu.md")
      };
    }
    case "codex":
      return {
        instructions: [join(project ? root : dirs.codex, "AGENTS.md")],
        skills: sharedSkills,
        mcp: join(dirs.codex, "config.toml")
      };
    case "pi":
      return {
        instructions: [join(project ? root : dirs.pi, "AGENTS.md")],
        skills: sharedSkills,
        mcp: join(dirs.pi, "mcp.json")
      };
    case "opencode":
      return {
        instructions: [join(project ? root : dirs.opencode, "AGENTS.md")],
        skills: sharedSkills,
        mcp: join(project ? root : dirs.opencode, "opencode.json")
      };
    case "agy":
      return {
        instructions: project ? [join(root, "GEMINI.md"), join(root, "AGENTS.md")] : [join(dirs.gemini, "GEMINI.md"), join(dirs.gemini, "AGENTS.md")],
        skills: sharedSkills
      };
  }
}
function sharedTargetPaths(home, dirs = installDirs(home)) {
  return [join(dirs.codex, "config.toml"), join(dirs.pi, "mcp.json")];
}
function configuredBases(root, home, dirs = installDirs(home)) {
  return [...new Set([root, home].flatMap((base) => [resolve(base), ...[".edu", ".agents", ".claude"].map((name) => resolve(base, name))]).concat([".codex", ".pi", ".config/opencode", ".gemini"].map((name) => resolve(home, name))).concat([dirs.codex, dirs.pi]))];
}
async function pinConfiguredBases(root, home, dirs = installDirs(home)) {
  return Promise.all(configuredBases(root, home, dirs).map(async (path) => ({ path, canonical: await canonicalAnchor(path) })));
}
function baseFor(path, pins) {
  const target = resolve(path);
  return pins.filter((pin) => target === pin.path || target.startsWith(pin.path + sep)).sort((a, b) => b.path.length - a.path.length)[0];
}
function nativePath(value) {
  if (typeof value !== "string") return value;
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\\\${value.slice(8)}`;
  return /^\\\\\?\\[A-Za-z]:\\/.test(value) ? value.slice(4) : value;
}
function samePath(a, b, platform = process.platform) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = nativePath(a);
  const right = nativePath(b);
  if (platform !== "win32") return left === right;
  const normal = (path) => path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return normal(left) === normal(right);
}

// src/adapters/installer.ts
import { randomUUID } from "crypto";
import { readFile as readFile5, readdir as readdir2, rename as rename2, rmdir, unlink, writeFile as writeFile3 } from "fs/promises";
import { homedir } from "os";
import { basename, dirname as dirname3, isAbsolute, join as join7, resolve as resolve4 } from "path";

// src/adapters/claude.ts
import { readFile as readFile3 } from "fs/promises";
import { join as join4 } from "path";

// src/adapters/common.ts
import { readdir, readFile, lstat } from "fs/promises";
import { join as join2 } from "path";
function protocol(scope, home, brainRoot) {
  const pointer = scope === "project" ? "@.edu/EDU.md" : `@${join2(brainRoot ?? join2(home, ".edu"), "EDU.md")}`;
  return `${pointer}
1. Reuse an injected Edu brief; call \`edu_brief\` only if absent or explicitly refreshing.
2. Retain an injected Edu session id; only if absent, \`edu_session_open\` (title, source) and keep its exact returned id per workspace.
3. Recall on demand with \`edu_recall\`, then \`edu_read\`; cite ids, scope, claim bands and evidence.
4. Record decisions and lessons with \`edu_remember\`. Memory is stored notes, not model training. \`edu_feedback\` is advisory, never proof that a lesson is proven. Check \`edu_capabilities\` for the installed version; unavailable means unknown.
5. Close with \`edu_session_close\` using that exact id and a summary. Optionally include up to 3 durable \`lessons\` ({title, body, evidence:[existing ids]}); they are candidate/inferred observations, never verified facts. Do not invent a lesson or run another model to extract it. Report what remains open; never invent an id or claim closure after failure.
Tool names are logical names: in Pi discover \`mcp__edu__edu_*\` through codemode/tool_search as needed. Pi requests a host-owned workspace lock: change the host cwd and restart MCP rather than switching only with \`edu_project_use\`. Other clients may allow that tool: verify scope and retain separate session ids. Use crew only for independent work, substantial review or an explicit request; do not spawn extra agents for every trivial task.`;
}
function instructionActions(cli, scope, root, options) {
  return pathsFor(cli, scope, root, options.home, options.dirs).instructions.map((path) => ({
    cli,
    kind: "managed-block",
    path,
    description: "Install Edu protocol block",
    content: protocol(scope, options.home, options.brainRoot)
  }));
}
async function skillActions(cli, scope, root, options) {
  const bases = options.bases ?? await pinConfiguredBases(root, options.home);
  const destination = pathsFor(cli, scope, root, options.home).skills;
  const brain = join2(scope === "project" ? root : options.home, ".edu/skills");
  const sources = [{ root: join2(options.templatesDir, "skills"), anchor: options.templatesDir }, { root: brain, custom: true, anchor: join2(scope === "project" ? root : options.home, ".edu") }];
  const skills = /* @__PURE__ */ new Map();
  for (const source of sources) {
    const sourceCanonical = await canonicalAnchor(source.anchor);
    try {
      await lstat(source.root);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    try {
      await assertContained(source.anchor, source.root);
      if (!(await lstat(source.root)).isDirectory()) throw new UnsupportedSkillPathError(`Non-directory skill source: ${source.root}`);
    } catch (error) {
      if (!source.custom || !(error instanceof UnsupportedSkillPathError)) throw error;
      skills.clear();
      options.notes?.push(`Skipped custom skill source ${source.root}: ${error.message}; builtin skills also skipped because overrides cannot be inspected.`);
      continue;
    }
    for (const name of (await readdir(source.root)).sort()) {
      if (!/^[a-zA-Z0-9][\w-]*$/.test(name)) continue;
      const directory = join2(source.root, name), file = join2(directory, "SKILL.md");
      if (source.custom) {
        try {
          await assertContained(source.anchor, directory);
          await assertContained(source.anchor, file);
          try {
            if (!(await lstat(file)).isFile()) throw new UnsupportedSkillPathError(`Non-regular skill document: ${file}`);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        } catch (error) {
          if (!(error instanceof UnsupportedSkillPathError)) throw error;
          skills.delete(name);
          options.notes?.push(`Skipped custom skill ${name}: ${error.message}; builtin override remains suppressed.`);
          continue;
        }
      }
      try {
        await lstat(file);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      let bundle;
      try {
        bundle = await readSkillBundle(directory, name, { anchor: source.anchor, checkRequirements: false });
      } catch (error) {
        if (!source.custom || !(error instanceof UnsupportedSkillEncodingError)) throw error;
        skills.delete(name);
        options.notes?.push(`Skipped custom skill ${name}: ${error.message}; builtin override remains suppressed.`);
        continue;
      }
      if (bundle.metadata.hosts && !bundle.metadata.hosts.includes(cli)) {
        skills.delete(name);
        options.notes?.push(`Skipped skill ${name} for unsupported host ${cli}.`);
        continue;
      }
      for (const requirement of bundle.metadata.requires) if (!await (options.detectBinary ?? binaryOnPath)(requirement)) throw new Error(`Missing bundle requirement: ${requirement}`);
      const destinationBase = join2(scope === "project" ? root : options.home, cli === "claude" ? ".claude" : ".agents");
      const destinationPin = baseFor(destinationBase, bases);
      skills.set(name, bundle.files.map((file2) => ({
        cli,
        kind: "file",
        path: join2(destination, name, file2.path),
        description: `Install ${name} skill bundle ${file2.path}`,
        content: file2.content,
        bundle: {
          name,
          bases,
          base: destinationPin,
          root: join2(destination, name),
          anchor: scope === "project" ? root : options.home,
          scope,
          relative: file2.path,
          source: { path: join2(directory, file2.path), anchor: source.anchor, canonical: sourceCanonical, sha256: file2.sha256 }
        }
      })));
    }
  }
  return [...skills.values()].flat();
}
async function agentTemplates(templatesDir) {
  const dir = join2(templatesDir, "agents");
  const result = [];
  for (const filename of (await readdir(dir)).filter((name) => name.endsWith(".md")).sort()) {
    const text = await readFile(join2(dir, filename), "utf8");
    let template;
    try {
      template = parseFrontmatter(text);
    } catch {
      template = void 0;
    }
    if (!template) throw new Error(`Malformed agent template: ${filename}`);
    const field = (key) => typeof template.meta[key] === "string" ? template.meta[key] : void 0;
    const name = field("id");
    if (!name || !/^[\w-]+$/.test(name)) throw new Error(`Invalid agent template: ${filename}`);
    result.push({ name, description: field("mission") ?? field("title") ?? name, tools: field("autonomy") === "readonly" ? "Read, Grep, Glob" : "Read, Write, Edit, Bash, Grep, Glob", prompt: template.body });
  }
  return result;
}

// src/adapters/operations.ts
import { createHash } from "crypto";
import { access, lstat as lstat2, mkdir, readFile as readFile2, writeFile, chmod } from "fs/promises";
import { dirname, join as join3, resolve as resolve2, sep as sep2 } from "path";

// src/adapters/merge.ts
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";

// src/adapters/toml.ts
function tomlKeyParts(key) {
  const parts = [];
  let rest = key.trim();
  while (rest) {
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(rest) ?? /^'([^']*)'/.exec(rest) ?? /^([A-Za-z0-9_-]+)/.exec(rest);
    if (!match) return void 0;
    parts.push(match[0].startsWith('"') ? match[1].replace(/\\(.)/g, "$1") : match[1]);
    rest = rest.slice(match[0].length).trimStart();
    if (!rest) break;
    if (!rest.startsWith(".")) return void 0;
    rest = rest.slice(1).trimStart();
  }
  return parts.length ? parts : void 0;
}
function keyEnd(line) {
  let quote;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = void 0;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "=") return i;
    else if (char === "#" || char === "[" || char === "{") return -1;
  }
  return -1;
}
function openBrackets(value) {
  let depth = 0;
  let quote;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = void 0;
      continue;
    }
    if (char === "#") break;
    if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
  }
  return depth;
}
var UNKNOWN_TABLE = "\0";
function scanTomlLines(text) {
  const pieces = text.split(/(\r?\n)/);
  const lines = [];
  let table = [];
  let multiline;
  let depth = 0;
  for (let i = 0; i < pieces.length; i += 2) {
    const raw = pieces[i];
    const base = { text: raw, eol: pieces[i + 1] ?? "" };
    const line = raw.trim();
    if (multiline) {
      if (line.includes(multiline)) multiline = void 0;
      lines.push({ ...base, table, continuation: true });
      continue;
    }
    if (depth > 0) {
      depth += openBrackets(line);
      lines.push({ ...base, table, continuation: true });
      continue;
    }
    const header = !line || line.startsWith("#") ? null : /^\[(\[?)\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      const path = tomlKeyParts(header[2]);
      table = path ?? [UNKNOWN_TABLE];
      lines.push({ ...base, table, header: { path, array: header[1] === "[" }, continuation: false });
      continue;
    }
    const end = !line || line.startsWith("#") ? -1 : keyEnd(line);
    const key = end > 0 ? tomlKeyParts(line.slice(0, end)) : void 0;
    if (end <= 0) {
      lines.push({ ...base, table, continuation: false });
      continue;
    }
    const value = line.slice(end + 1).trim();
    lines.push({ ...base, table, ...key ? { key } : {}, value, continuation: false });
    for (const quote of ['"""', "'''"]) {
      if (value.startsWith(quote) && value.split(quote).length === 2) multiline = quote;
    }
    if (!multiline) depth = Math.max(0, openBrackets(value));
  }
  return lines;
}
function tomlKeys(text) {
  return scanTomlLines(text).flatMap((line) => {
    if (line.header) return line.header.path ? [{ path: line.header.path, header: true, table: [] }] : [];
    return line.key ? [{ path: [...line.table, ...line.key], header: false, table: line.table }] : [];
  });
}
var tomlPathStarts = (path, prefix) => path.length >= prefix.length && prefix.every((part, i) => path[i] === part);
function tomlDefines(text, path) {
  return tomlKeys(text).some((key) => tomlPathStarts(key.path, path));
}
function tomlEnabledTables(text, root) {
  const states = /* @__PURE__ */ new Map();
  for (const line of scanTomlLines(text)) {
    const path = line.header?.path ?? (line.key ? [...line.table, ...line.key] : void 0);
    if (line.continuation || !path || path[0] !== root || !path[1]) continue;
    const name = path[1];
    if (!states.has(name)) states.set(name, true);
    const off = path.length === 3 && path[2] === "enabled" ? /^false\b/.test(line.value ?? "") : path.length === 2 && !line.header && /\benabled\s*=\s*false\b/.test(line.value ?? "");
    if (off) states.set(name, false);
  }
  return states;
}
function withoutTomlTable(body, path) {
  let skipping = false;
  return scanTomlLines(body).filter((line) => {
    if (line.header) skipping = !!line.header.path && tomlPathStarts(line.header.path, path);
    return !skipping;
  }).map((line) => line.text).join("\n").trim();
}

// src/adapters/merge.ts
var UNION = "$union";
function unionItems(value) {
  return record(value) && Object.keys(value).length === 1 && Array.isArray(value[UNION]) ? value[UNION] : void 0;
}
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseJson(text) {
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!record(parsed)) throw new Error("Expected a JSON object");
  return parsed;
}
function jsonStyle(text) {
  if (!text.trim()) return { indent: "  ", eol: "\n", finalNewline: true };
  const indented = /\n([ \t]+)\S/.exec(text);
  const indent = indented ? indented[1].startsWith("	") ? "	" : " ".repeat(indented[1].length) : text.trim().includes("\n") ? "  " : "";
  return { indent, eol: eolOf(text), finalNewline: /\n$/.test(text) };
}
function serializeLike(original, value) {
  return serialize(value, jsonStyle(original));
}
function jsoncFormatFor(text) {
  return formatFor(text);
}
function serialize(value, style) {
  return `${JSON.stringify(value, null, style.indent).replace(/\n/g, style.eol)}${style.finalNewline ? style.eol : ""}`;
}
function isEduHook(value) {
  return record(value) && (value.command === "edu hook session-start" || value.command === "edu hook session-end");
}
function isEduEntry(value) {
  return record(value) && (value.edu === true || value.matcher === "edu" || Array.isArray(value.hooks) && value.hooks.some(isEduHook));
}
var isEduEntryArray = (value) => Array.isArray(value) && value.length > 0 && value.every(isEduEntry);
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
    const added = unionItems(value);
    if (added) {
      const prior = Array.isArray(target[key]) ? target[key] : [];
      target[key] = [...prior, ...added.filter((item) => !prior.some((existing) => same(existing, item)))];
    } else if (Array.isArray(value)) {
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
    const removed = unionItems(value);
    if (removed) {
      if (!Array.isArray(target[key])) continue;
      const remaining = target[key].filter((item) => !removed.some((owned) => same(owned, item)));
      if (remaining.length) target[key] = remaining;
      else delete target[key];
    } else if (Array.isArray(value) && Array.isArray(target[key])) {
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
  const result = serialize(target, jsonStyle(text));
  return JSON.stringify(parseJson(text)) === JSON.stringify(target) ? text : result;
}
function unmergeJson(text, patch) {
  const target = parseJson(text);
  removePatch(target, patch);
  const result = serialize(target, jsonStyle(text));
  return JSON.stringify(parseJson(text)) === JSON.stringify(target) ? text : result;
}
function containsPatch(target, patch) {
  const union = unionItems(patch);
  if (union) return Array.isArray(target) && union.every((item) => target.some((candidate) => same(candidate, item)));
  if (Array.isArray(patch)) {
    return Array.isArray(target) && patch.every((item) => target.some((candidate) => same(candidate, item)));
  }
  if (patch && typeof patch === "object") {
    if (!target || typeof target !== "object") return false;
    return Object.entries(patch).every(([key, value]) => containsPatch(target[key], value));
  }
  return same(target, patch);
}
function patchUnits(patch, prefix = []) {
  const units = [];
  const leaves2 = Object.entries(patch).filter(([, value]) => !record(value) && !isEduEntryArray(value));
  if (leaves2.length) units.push(...prefix.length ? [prefix] : leaves2.map(([key]) => [key]));
  for (const [key, value] of Object.entries(patch)) if (record(value) && !unionItems(value)) units.push(...patchUnits(value, [...prefix, key]));
  return units;
}
function without(patch, path) {
  const [key, ...rest] = path;
  if (key === void 0 || !(key in patch)) return patch;
  const copy = { ...patch };
  if (!rest.length || !record(copy[key])) delete copy[key];
  else {
    const inner = without(copy[key], rest);
    if (Object.keys(inner).length) copy[key] = inner;
    else delete copy[key];
  }
  return copy;
}
function resolveJsonPatch(path, text, patch, owned) {
  const target = parseJsonFile(path, text);
  let result = patch;
  const kept = [];
  for (const unit of patchUnits(patch)) {
    const current = at(target, unit);
    if (current === void 0) continue;
    const mine = owned ? at(owned, unit) : void 0;
    if (mine !== void 0 && containsPatch(current, mine)) continue;
    result = without(result, unit);
    if (!containsPatch(current, at(patch, unit))) kept.push(unit.join("."));
  }
  return { patch: result, kept };
}
var isJsonc = (path) => {
  const lower = path.toLowerCase().replace(/\\/g, "/");
  return lower.endsWith(".jsonc") || lower.endsWith("/opencode.json");
};
function formatFor(text) {
  const style = jsonStyle(text);
  return { formattingOptions: { insertSpaces: style.indent !== "	", tabSize: style.indent === "	" ? 1 : style.indent.length || 2, eol: style.eol } };
}
function parseJsonc(text) {
  if (!text.trim()) return {};
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
  if (!record(value)) throw new Error("Expected a JSON object");
  return value;
}
function leaves(patch, prefix = []) {
  return Object.entries(patch).flatMap(([key, value]) => {
    const union = unionItems(value);
    if (union) return [{ path: [...prefix, key], union }];
    return record(value) ? leaves(value, [...prefix, key]) : [{ path: [...prefix, key] }];
  });
}
function at(value, path) {
  return path.reduce((node, key) => record(node) ? node[key] : void 0, value);
}
function mergeJsonc(text, patch) {
  const before = parseJsonc(text);
  const after = parseJsonc(text);
  applyPatch(after, patch);
  if (same(before, after)) return text;
  let out = text.trim() ? text : "{}\n";
  const format = formatFor(text);
  for (const { path, union } of leaves(patch)) {
    const current = at(before, path);
    if (union && Array.isArray(current)) {
      for (const item of union.filter((item2) => !current.some((existing) => same(existing, item2))).reverse()) {
        out = applyEdits(out, modify(out, [...path, 0], item, { ...format, isArrayInsertion: true }));
      }
    } else out = applyEdits(out, modify(out, path, at(after, path), format));
  }
  return out;
}
function unmergeJsonc(text, patch) {
  const before = parseJsonc(text);
  const after = parseJsonc(text);
  removePatch(after, patch);
  if (same(before, after)) return text;
  let out = text;
  const format = formatFor(text);
  for (const { path, union } of leaves(patch)) {
    const current = at(before, path);
    if (union && Array.isArray(current) && Array.isArray(at(after, path))) {
      const owned = current.map((item, index) => union.some((mine) => same(mine, item)) ? index : -1).filter((index) => index >= 0);
      for (const index of owned.reverse()) out = applyEdits(out, modify(out, [...path, index], void 0, format));
      continue;
    }
    const cut = path.findIndex((_, i) => at(after, path.slice(0, i + 1)) === void 0);
    if (cut >= 0) {
      if (at(before, path.slice(0, cut + 1)) !== void 0) out = applyEdits(out, modify(out, path.slice(0, cut + 1), void 0, format));
    } else out = applyEdits(out, modify(out, path, at(after, path), format));
  }
  return out;
}
function named(path, run) {
  try {
    return run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const expected = isJsonc(path) ? "a JSON object (comments allowed)" : "a plain JSON object, without comments or trailing commas";
    throw new Error(`Cannot parse ${path}: ${reason}. It must hold ${expected}; fix it and run again.`);
  }
}
function mergeJsonFile(path, text, patch) {
  return named(path, () => isJsonc(path) ? mergeJsonc(text, patch) : mergeJson(text, patch));
}
function unmergeJsonFile(path, text, patch) {
  return named(path, () => isJsonc(path) ? unmergeJsonc(text, patch) : unmergeJson(text, patch));
}
function parseJsonFile(path, text) {
  return named(path, () => isJsonc(path) ? parseJsonc(text) : parseJson(text));
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
function splitTopLevel(body, eol) {
  const lines = body.trim().split(/\r?\n/);
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const cut = firstTable < 0 ? lines.length : firstTable;
  return { top: lines.slice(0, cut).join(eol).trim(), tables: lines.slice(cut).join(eol).trim() };
}
var eolAt = (text, end) => text.startsWith("\r\n", end) ? "\r\n" : text.startsWith("\n", end) ? "\n" : "";
function removeTopSection(text) {
  const span = tomlTopBounds(text);
  if (!span) return text;
  const [start, end] = span;
  return text.slice(0, start) + text.slice(end + eolAt(text, end).length);
}
function tomlSectionsDigest(text) {
  const top = tomlTopBounds(text);
  const main = tomlBounds(text);
  if (!top && !main) return void 0;
  return sectionDigest([top ? text.slice(...top) : "", main ? text.slice(...main) : ""].join("\n"));
}
var EDU_MCP_TOML_PATH = ["mcp_servers", "edu"];
function mergeToml(text, body) {
  const eol = eolOf(text);
  const user = unmergeToml(text);
  let { top, tables } = splitTopLevel(body, eol);
  if (hasTopLevelTomlKey(user, "notify")) {
    top = top.split(/\r?\n/).filter((line) => !/^\s*notify\s*=/.test(line)).join(eol).trim();
  }
  let result = removeTopSection(text);
  const span = tomlBounds(result);
  if (tables) {
    const section = `${TOML_START}${eol}${tables}${eol}${TOML_END}`;
    if (span) result = result.slice(0, span[0]) + section + result.slice(span[1]);
    else {
      if (tomlDefines(result, EDU_MCP_TOML_PATH) && tomlDefines(tables, EDU_MCP_TOML_PATH)) throw new Error("Unmanaged Edu MCP TOML section already exists");
      result = `${result}${result ? eol : ""}${section}${eol}`;
    }
  } else if (span) result = unmergeToml(result);
  if (top) result = `${TOML_TOP_START}${eol}${top}${eol}${TOML_TOP_END}${eol}${result}`;
  return result;
}
function hasTopLevelTomlKey(text, key) {
  return tomlKeys(unmergeToml(text)).some((entry) => !entry.header && !entry.table.length && entry.path.length === 1 && entry.path[0] === key);
}
function unmergeToml(input) {
  const text = removeTopSection(input);
  const span = tomlBounds(text);
  if (!span) return text;
  const [start, end] = span;
  const eol = eolAt(text, end);
  if (eol && end + eol.length === text.length) {
    const prefix = text.slice(0, start);
    return prefix.endsWith(eol) ? prefix.slice(0, -eol.length) : prefix;
  }
  return text.slice(0, start) + text.slice(end);
}

// src/adapters/operations.ts
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
async function readTarget(path) {
  try {
    const stat2 = await lstat2(path);
    if (!stat2.isFile()) throw new Error(`Refusing non-regular target: ${path}`);
    return await readFile2(path);
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
}
function materialize(action, before) {
  const text = before?.toString("utf8") ?? "";
  switch (action.kind) {
    case "managed-block":
      return Buffer.from(named2(action.path, () => upsertManagedBlock(text, action.content ?? "")), "utf8");
    case "file":
      return Buffer.from(action.content ?? "", "utf8");
    case "json-merge":
      return Buffer.from(mergeJsonFile(action.path, text, action.jsonPatch ?? {}), "utf8");
    case "toml-merge":
      return Buffer.from(named2(action.path, () => mergeToml(text, action.tomlBody ?? "")), "utf8");
    default:
      throw new Error(`Unsupported action kind: ${action.kind}`);
  }
}
function named2(path, run) {
  try {
    return run();
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function ensureParents(path, createdDirs, transaction) {
  await transaction?.check(path);
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
    transaction?.createdDirs.add(next);
    if (!createdDirs.includes(next)) createdDirs.push(next);
  }
}
async function applyStandaloneActions(actions, home) {
  const bundle = actions.find((action) => action.bundle)?.bundle;
  if (bundle) {
    const { applyInstall: applyInstall2 } = await import("./installer-WLGGQIG3.js");
    const manifest = await applyInstall2({ scope: bundle.scope, root: bundle.anchor, home, templatesDir: packageTemplatesDir(), notes: [], actions });
    return manifest.actions.filter((action) => actions.some((planned) => planned.path === action.path));
  }
  const result = [];
  const created = [];
  for (const [index, action] of actions.entries()) {
    const before = await readTarget(action.path);
    const after = materialize(action, before);
    if (before?.equals(after)) continue;
    let backup;
    if (before !== void 0) {
      backup = join3(home, ".edu/backups", `standalone-${Date.now()}`, `${index}-${sha256(action.path)}`);
      await ensureParents(backup, created);
      await writeFile(backup, before);
    }
    await ensureParents(action.path, created);
    await writeFile(action.path, after);
    result.push({ cli: action.cli, kind: action.kind, path: action.path, description: action.description, sha256: sha256(after), backup });
  }
  return result;
}
var FileTransaction = class {
  before = /* @__PURE__ */ new Map();
  createdDirs = /* @__PURE__ */ new Set();
  removedDirs = /* @__PURE__ */ new Map();
  anchors = /* @__PURE__ */ new Set();
  bases = /* @__PURE__ */ new Map();
  async check(path) {
    if (!this.anchors.size) return;
    const absolute = resolve2(path);
    const anchor = [...this.anchors, ...this.bases.keys()].filter((root) => absolute === root || absolute.startsWith(root + sep2)).sort((a, b) => b.length - a.length)[0];
    if (!anchor) throw new Error(`Installer path escapes containment: ${path}`);
    await assertContained(anchor, absolute, this.bases.get(anchor));
  }
  async capture(path) {
    await this.check(path);
    if (this.before.has(path)) return;
    const content = await readTarget(path);
    this.before.set(path, content === void 0 ? void 0 : { content, mode: (await lstat2(path)).mode & 511 });
  }
  // Every change retries while Windows reports the target as held open by another process.
  async write(path, content) {
    await this.capture(path);
    await retryFs.writeFile(path, content);
  }
  async remove(path) {
    await this.capture(path);
    await retryFs.unlink(path);
  }
  async move(from, to) {
    await this.capture(from);
    await this.capture(to);
    await retryFs.rename(from, to);
  }
  async removeEmptyDirectory(path) {
    await this.check(path);
    const mode = (await lstat2(path)).mode & 511;
    await retryFs.rmdir(path);
    if (!this.createdDirs.has(path)) this.removedDirs.set(path, mode);
  }
  async rollback() {
    const failures = [];
    for (const [path, mode] of [...this.removedDirs].sort(([a], [b]) => a.length - b.length)) {
      try {
        await this.check(path);
        await mkdir(path);
        await chmod(path, mode);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const [path, before] of [...this.before].reverse()) {
      try {
        await this.check(path);
        if (before) {
          await retryFs.writeFile(path, before.content);
          await chmod(path, before.mode);
        } else await retryFs.unlink(path).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      } catch (error) {
        failures.push(error);
      }
    }
    for (const path of [...this.createdDirs].reverse()) {
      try {
        await this.check(path);
        await retryFs.rmdir(path);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) failures.push(error);
      }
    }
    this.before.clear();
    this.createdDirs.clear();
    this.removedDirs.clear();
    if (failures.length) throw new AggregateError(failures, "Installation rollback incomplete");
  }
};
async function validateBundleAction(action, bases = []) {
  if (!action.bundle) return;
  const { root, anchor, relative, source } = action.bundle;
  portablePath(relative);
  if (action.kind !== "file" || action.path !== join3(root, relative)) throw new Error(`Invalid bundle target: ${action.path}`);
  const pin = action.bundle.base ?? baseFor(action.path, bases);
  if (pin && pin.path !== anchor && pin.path !== join3(anchor, action.cli === "claude" ? ".claude" : ".agents")) throw new Error("Untrusted bundle base");
  if (pin && pin.path !== anchor && !pin.path.startsWith(resolve2(anchor) + sep2)) throw new Error("Bundle base escapes scope");
  await assertContained(pin?.path ?? anchor, root, pin?.canonical);
  await assertContained(pin?.path ?? anchor, action.path, pin?.canonical);
  if (source) {
    await assertContained(source.anchor, source.path, source.canonical);
    const current = await readTarget(source.path);
    if (!current || sha256(current) !== source.sha256 || sha256(action.content ?? "") !== source.sha256) throw new Error(`Bundle source changed after planning: ${source.path}`);
  }
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
  const paths = pathsFor("claude", scope, root, options.home, options.dirs);
  const actions = [...instructionActions("claude", scope, root, options), ...await skillActions("claude", scope, root, options)];
  for (const agent of await agentTemplates(options.templatesDir)) {
    const header = `---
name: ${agent.name}
description: ${JSON.stringify(agent.description)}
tools: ${agent.tools}
---
`;
    actions.push({ cli: "claude", kind: "file", path: join4(paths.agents, `${agent.name}.md`), description: `Install ${agent.name} subagent`, content: `${header}
${agent.prompt}
` });
  }
  actions.push({ cli: "claude", kind: "json-merge", path: paths.mcp, description: "Register Edu MCP server", jsonPatch: { mcpServers: { edu: { ...eduMcpLaunch(options.platform) } } } });
  const identityPath = join4(scope === "project" ? root : options.home, ".edu/EDU.md");
  const identity = await readFile3(identityPath, "utf8").catch(() => readFile3(join4(options.templatesDir, "EDU.md"), "utf8"));
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
import { dirname as dirname2, join as join5 } from "path";
function codexNotifyArgv(templatesDir, platform = process.platform, execPath = process.execPath) {
  if (platform !== "win32") return ["edu", "hook", "codex-notify"];
  return [execPath, join5(dirname2(templatesDir), "dist", "cli.js"), "hook", "codex-notify"];
}
async function plan2(scope, root, options) {
  const paths = pathsFor("codex", scope, root, options.home, options.dirs);
  const entry = codexMcpEntry(eduMcpLaunch(options.platform));
  return [
    ...instructionActions("codex", scope, root, options),
    ...await skillActions("codex", scope, root, options),
    { cli: "codex", kind: "toml-merge", path: paths.mcp, description: "Register Edu MCP server and Codex notify hook", tomlBody: `notify = [${codexNotifyArgv(options.templatesDir, options.platform).map((arg) => JSON.stringify(arg)).join(", ")}]

[mcp_servers.edu]
command = ${JSON.stringify(entry.command)}
args = ${JSON.stringify(entry.args)}
env_vars = ${JSON.stringify(entry.env_vars)}` }
  ];
}
function createCodexIntegration(options) {
  return createIntegration("codex", options, plan2);
}

// src/adapters/pi.ts
async function plan3(scope, root, options) {
  const paths = pathsFor("pi", scope, root, options.home, options.dirs);
  return [
    ...instructionActions("pi", scope, root, options),
    ...await skillActions("pi", scope, root, options),
    { cli: "pi", kind: "json-merge", path: paths.mcp, description: "Register Edu MCP server", jsonPatch: { mcpServers: { edu: { ...eduMcpLaunch(options.platform) } } } }
  ];
}
function createPiIntegration(options) {
  return createIntegration("pi", options, plan3);
}

// src/adapters/opencode.ts
async function plan4(scope, root, options) {
  const paths = pathsFor("opencode", scope, root, options.home, options.dirs);
  const launch = eduMcpLaunch(options.platform);
  const agents = {};
  for (const agent of await agentTemplates(options.templatesDir)) {
    agents[agent.name] = { description: agent.description, prompt: agent.prompt, mode: "subagent" };
  }
  return [
    ...instructionActions("opencode", scope, root, options),
    ...await skillActions("opencode", scope, root, options),
    { cli: "opencode", kind: "json-merge", path: paths.mcp, description: "Register Edu MCP server and agents", jsonPatch: { mcp: { edu: { type: "local", command: [launch.command, ...launch.args], enabled: true } }, agent: agents } }
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

// src/adapters/install-lock.ts
import { AsyncLocalStorage } from "async_hooks";
import { mkdir as mkdir2, readFile as readFile4, rename, rm, stat, writeFile as writeFile2 } from "fs/promises";
import { hostname } from "os";
import { join as join6, resolve as resolve3 } from "path";
var INSTALL_LOCK_WAIT_MS = 12e4;
var OWNERLESS_STALE_MS = 1e4;
var held = new AsyncLocalStorage();
function installLockPath(home) {
  return join6(resolve3(home), ".edu-install.lock");
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function stale(path) {
  try {
    const owner = await readFile4(join6(path, "owner"), "utf8").catch(() => void 0);
    if (owner === void 0) return Date.now() - (await stat(path)).mtimeMs > OWNERLESS_STALE_MS;
    const [pid, host] = owner.trim().split(/\s+/, 2);
    if (host && host !== hostname()) return false;
    return !(Number.isInteger(Number(pid)) && Number(pid) > 0 && alive(Number(pid)));
  } catch {
    return false;
  }
}
async function withInstallLock(home, body, options = {}) {
  const path = installLockPath(home);
  const store = held.getStore();
  if (store?.has(path)) return body();
  const sleep = options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const deadline = Date.now() + (options.waitMs ?? INSTALL_LOCK_WAIT_MS);
  for (; ; ) {
    try {
      await mkdir2(path);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (await stale(path)) {
      const claimed = `${path}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename(path, claimed);
        await rm(claimed, { recursive: true, force: true });
      } catch {
      }
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Another Edu install, setup or uninstall is running (lock ${path}). Wait for it to finish; if none is running, delete that folder and try again.`);
    }
    await sleep(50);
  }
  try {
    await writeFile2(join6(path, "owner"), `${process.pid} ${hostname()}
`);
    return await held.run(/* @__PURE__ */ new Set([...store ?? [], path]), body);
  } finally {
    await withFsRetry(() => rm(path, { recursive: true, force: true }));
  }
}

// src/adapters/installer.ts
function sharedRegistryPath(home) {
  return join7(home, ".edu/shared-targets.json");
}
function ownDigest(kind, content) {
  const text = content.toString("utf8");
  try {
    if (kind === "managed-block") {
      const block = managedBlock(text);
      return block === void 0 ? void 0 : sectionDigest(block);
    }
    if (kind === "toml-merge") return tomlSectionsDigest(text);
  } catch {
  }
  return void 0;
}
async function isActionIntact(action, current) {
  if (!current) return false;
  if (action.sha256 && sha256(current) === action.sha256) return true;
  const text = current.toString("utf8");
  try {
    switch (action.kind) {
      case "json-merge":
        return !!action.jsonPatch && containsPatch(parseJsonFile(action.path, text), action.jsonPatch);
      case "managed-block": {
        const block = managedBlock(text);
        if (block === void 0) return false;
        if (action.blockSha256) return sectionDigest(block) === action.blockSha256;
        const before = action.backup ? await readTarget(action.backup) : Buffer.alloc(0);
        return !!before && !!action.sha256 && sha256(upsertManagedBlock(before.toString("utf8"), managedBlockBody(block), "\n")) === action.sha256;
      }
      case "toml-merge": {
        const digest = tomlSectionsDigest(text);
        if (!digest) return false;
        if (action.blockSha256) return digest === action.blockSha256;
        return !!action.tomlBody && tomlSectionsDigest(mergeToml(unmergeToml(text), action.tomlBody)) === digest;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}
function driftError(path) {
  return new Error(`Edu installation drift: ${path} changed inside the part Edu manages. Restore that part, or run edu uninstall --force to remove Edu's part anyway.`);
}
function keptNote(unit, path) {
  const hint = unit === "statusLine" ? ' (set its command to "edu statusline" to use the Edu statusline)' : "";
  return `Kept your own ${unit} in ${path}; Edu did not change it${hint}.`;
}
async function loadSharedRegistry(home) {
  const path = sharedRegistryPath(home);
  const content = await readTarget(path);
  if (!content) return { version: 1, targets: {}, createdDirs: [] };
  const value = parseStateFile(path, content);
  if (!value || typeof value !== "object" || value.version !== 1 || !value.targets || !Array.isArray(value.createdDirs)) {
    throw new Error(`Invalid Edu shared-target registry: ${path}`);
  }
  return value;
}
async function saveSharedRegistry(home, registry, transaction) {
  const path = sharedRegistryPath(home);
  if (!Object.keys(registry.targets).length) {
    await (transaction ? transaction.remove(path) : unlink(path)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  await ensureParents(path, registry.createdDirs, transaction);
  const temp = `${path}.${randomUUID()}.tmp`;
  await (transaction ? transaction.write(temp, `${JSON.stringify(registry, null, 2)}
`) : writeFile3(temp, `${JSON.stringify(registry, null, 2)}
`));
  await (transaction ? transaction.move(temp, path) : rename2(temp, path));
}
function parseStateFile(path, content) {
  try {
    return JSON.parse(content.toString("utf8"));
  } catch (error) {
    throw new Error(`Edu state file ${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Restore it from a backup or remove it, then run again.`);
  }
}
function getManifestPath(scope, root, home) {
  return join7(scope === "project" ? root : home, ".edu/manifest.json");
}
async function planInstall(options) {
  const root = resolve4(options.root);
  const home = resolve4(options.home ?? homedir());
  const templatesDir = resolve4(options.templatesDir ?? packageTemplatesDir());
  const clis = options.clis === "all" ? [...CLI_IDS] : [...new Set(options.clis)];
  for (const cli of clis) if (!CLI_IDS.includes(cli)) throw new Error(`Unknown CLI: ${cli}`);
  const notes = clis.includes("agy") ? ["agy MCP: manual step"] : [];
  const dirs = installDirs(home, options.env ?? {});
  const bases = await pinConfiguredBases(root, home, dirs);
  const settings = { home, templatesDir, bases, dirs, platform: options.platform, selectedHosts: options.selectedHosts ?? clis, notes };
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
  return { scope: options.scope, root, home, templatesDir, actions, notes, bases, dirs };
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
  const value = parseStateFile(path, content);
  if (!value || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.actions)) {
    throw new Error(`Invalid Edu manifest: ${path}`);
  }
  return value;
}
function publicAction(action, after, backup, shared = false, hash = sha256(after)) {
  const blockSha256 = ownDigest(action.kind, after);
  return { ...action.bundle ? { bundle: { name: action.bundle.name, root: action.bundle.root, anchor: action.bundle.anchor, scope: action.bundle.scope, relative: action.bundle.relative } } : {}, cli: action.cli, clis: action.clis ?? [action.cli], kind: action.kind, path: action.path, description: action.description, sha256: hash, ...backup ? { backup } : {}, ...shared ? { shared: true } : {}, ...action.jsonPatch ? { jsonPatch: action.jsonPatch } : {}, ...action.tomlBody ? { tomlBody: action.tomlBody } : {}, ...blockSha256 ? { blockSha256 } : {} };
}
var BACKUP_IGNORE = "*\n";
async function ignoreBackups(dir, createdDirs, transaction) {
  const path = join7(dir, ".gitignore");
  await ensureParents(path, createdDirs, transaction);
  if (!await readTarget(path)) await transaction.write(path, BACKUP_IGNORE);
}
async function dropBackupIgnore(dir, transaction) {
  const entries = await readdir2(dir).catch(() => void 0);
  if (entries?.length === 1 && entries[0] === ".gitignore" && (await readTarget(join7(dir, ".gitignore")))?.toString("utf8") === BACKUP_IGNORE) {
    await transaction.remove(join7(dir, ".gitignore"));
  }
}
async function ownerAction(owners, path) {
  for (const owner of owners) {
    const action = (await loadManifest(owner).catch(() => void 0))?.actions.find((item) => item.path === path);
    if (action) return action;
  }
  return void 0;
}
async function applyInstall(plan6, options = {}) {
  return withInstallLock(plan6.home, async () => {
    const transaction = options.transaction ?? new FileTransaction();
    try {
      return await applyPreparedInstall(plan6, transaction, options.manifestPath);
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollback) {
        throw new AggregateError([error, rollback], "Installation failed and rollback incomplete");
      }
      throw error;
    }
  });
}
async function applyPreparedInstall(plan6, transaction, explicitManifest) {
  const manifestPath = explicitManifest ?? getManifestPath(plan6.scope, plan6.root, plan6.home);
  transaction.anchors.add(resolve4(plan6.root));
  transaction.anchors.add(resolve4(plan6.home));
  const dirs = plan6.dirs ?? installDirs(plan6.home);
  const sharedPaths = new Set(sharedTargetPaths(plan6.home, dirs));
  const isSharedTarget = (path) => sharedPaths.has(path);
  const allowedBases = configuredBases(plan6.root, plan6.home, dirs);
  const bases = [...plan6.bases ?? await pinConfiguredBases(plan6.root, plan6.home, dirs), ...plan6.actions.flatMap((a) => a.bundle?.bases ?? [])];
  for (const pin of bases) {
    if (!allowedBases.includes(pin.path)) throw new Error(`Untrusted install base: ${pin.path}`);
    await assertContained(pin.path, pin.path, pin.canonical);
    transaction.bases.set(pin.path, pin.canonical);
  }
  await transaction.check(manifestPath);
  await transaction.check(sharedRegistryPath(plan6.home));
  for (const action of plan6.actions) {
    if (action.bundle && action.bundle.anchor !== (plan6.scope === "project" ? plan6.root : plan6.home)) throw new Error("Bundle anchor does not match install scope");
    await validateBundleAction(action, bases);
  }
  const previous = await loadManifest(manifestPath);
  if (previous && previous.scope !== plan6.scope) throw new Error("Existing manifest has a different scope");
  const shared = await loadSharedRegistry(plan6.home);
  const otherScope = plan6.scope === "project" ? "global" : "project";
  const otherPath = getManifestPath(otherScope, plan6.root, plan6.home);
  if (otherPath !== manifestPath) {
    const found = await loadManifest(otherPath);
    const other = found?.scope === otherScope ? found : void 0;
    const otherTargets = new Set(other?.actions.map((action) => action.path) ?? []);
    const conflict = plan6.actions.find((action) => otherTargets.has(action.path) && (!isSharedTarget(action.path) || !shared.targets[action.path]));
    if (conflict) throw new Error(`Target already managed by ${otherScope} installation: ${conflict.path}`);
  }
  const planned = new Set(plan6.actions.map((action) => action.path));
  const bundleRoots = new Set(plan6.actions.flatMap((action) => action.bundle ? [action.bundle.root] : []));
  const retiring = (previous?.actions ?? []).filter((action) => !planned.has(action.path) && (isRetired(action, plan6.retire ?? []) || action.bundle && bundleRoots.has(action.bundle.root)));
  for (const action of retiring) if (action.bundle) await validateBundleAction(action, bases);
  const existing = new Map((previous?.actions ?? []).map((action) => [`${action.kind}:${action.path}`, action]));
  for (const action of previous?.actions ?? []) {
    if (retiring.includes(action)) continue;
    const current = await readTarget(action.path);
    if (!await isActionIntact(action, current)) throw driftError(action.path);
    if (action.shared && !shared.targets[action.path]?.owners.includes(manifestPath)) throw new Error(`Missing shared ownership: ${action.path}`);
  }
  const paths = /* @__PURE__ */ new Set();
  const prepared = await Promise.all(plan6.actions.map(async (planned2) => {
    if (paths.has(planned2.path)) throw new Error(`Multiple operations target ${planned2.path}`);
    paths.add(planned2.path);
    const before = await readTarget(planned2.path);
    const prior = existing.get(`${planned2.kind}:${planned2.path}`);
    const owner = isSharedTarget(planned2.path) ? shared.targets[planned2.path] : void 0;
    const recorded = prior ?? (owner ? await ownerAction(owner.owners, planned2.path) : void 0);
    let action = planned2;
    if (planned2.kind === "json-merge" && planned2.jsonPatch) {
      const resolved = resolveJsonPatch(planned2.path, before?.toString("utf8") ?? "", planned2.jsonPatch, recorded?.jsonPatch ?? (owner && !recorded ? planned2.jsonPatch : void 0));
      for (const unit of resolved.kept) plan6.notes.push(keptNote(unit, planned2.path));
      action = { ...planned2, jsonPatch: resolved.patch };
    } else if (planned2.kind === "toml-merge" && planned2.tomlBody && before) {
      let user;
      try {
        user = unmergeToml(before.toString("utf8"));
      } catch (error) {
        throw new Error(`${planned2.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (tomlDefines(user, EDU_MCP_TOML_PATH) && tomlDefines(planned2.tomlBody, EDU_MCP_TOML_PATH)) {
        plan6.notes.push(keptNote(`[${EDU_MCP_TOML_PATH.join(".")}]`, planned2.path));
        action = { ...planned2, tomlBody: withoutTomlTable(planned2.tomlBody, EDU_MCP_TOML_PATH) };
      }
    }
    const after = materialize(action, before);
    if (action.bundle && before !== void 0 && !prior) throw new Error(`Unowned bundle target collision: ${action.path}. Preserve the entire legacy skill directory in a user-selected backup outside skills/, retain its accepted proposal record, review the new proposal, then explicitly accept into the vacant name; keep the backup until verified. A new reviewed skill name also avoids replacement.`);
    if (owner) {
      if (!await isActionIntact(recorded ?? { ...action, sha256: owner.sha256 }, before)) throw driftError(action.path);
      const changesEduPart = action.kind === "toml-merge" ? ownDigest(action.kind, before ?? Buffer.alloc(0)) !== ownDigest(action.kind, after) : !before?.equals(after);
      if (changesEduPart && owner.owners.some((path) => path !== manifestPath)) throw new Error(`Shared target has another owner: ${action.path}`);
    }
    return { action, before, after, prior };
  }));
  const createdDirs = [...previous?.createdDirs ?? []];
  const nextActions = (previous?.actions ?? []).filter((action) => !retiring.includes(action));
  const backupStamp = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const legacyBackups = [];
  let sharedChanged = false;
  for (const [index, { action, before, after, prior }] of prepared.entries()) {
    await validateBundleAction(action, bases);
    const key = `${action.kind}:${action.path}`;
    if (isSharedTarget(action.path)) {
      let target = shared.targets[action.path];
      if (!target && before?.equals(after) && !prior) continue;
      if (!target) {
        let backup2;
        if (prior?.backup || before) {
          const backups = join7(plan6.home, ".edu/shared-backups");
          backup2 = join7(backups, `${backupStamp}-${index}-${basename(action.path)}`);
          await ensureParents(backup2, shared.createdDirs, transaction);
          await ignoreBackups(backups, shared.createdDirs, transaction);
          if (prior?.backup) {
            await transaction.write(backup2, await readFile5(prior.backup));
            legacyBackups.push(prior.backup);
          } else await transaction.write(backup2, before);
        }
        target = { sha256: sha256(after), owners: [], ...backup2 ? { backup: backup2 } : {} };
        shared.targets[action.path] = target;
      }
      if (!before?.equals(after)) {
        await ensureParents(action.path, shared.createdDirs, transaction);
        await transaction.write(action.path, after);
        target.sha256 = sha256(after);
      }
      if (!target.owners.includes(manifestPath)) target.owners.push(manifestPath);
      const owners2 = [.../* @__PURE__ */ new Set([...prior?.clis ?? (prior ? [prior.cli] : []), ...action.clis ?? [action.cli]])];
      const saved2 = publicAction({ ...action, clis: owners2 }, after, target.backup, true, target.sha256);
      const oldIndex2 = nextActions.findIndex((item) => `${item.kind}:${item.path}` === key);
      if (oldIndex2 >= 0) nextActions[oldIndex2] = saved2;
      else nextActions.push(saved2);
      sharedChanged = true;
      continue;
    }
    if (before?.equals(after)) {
      if (prior) {
        const oldIndex2 = nextActions.findIndex((item) => `${item.kind}:${item.path}` === key);
        const digest = prior.blockSha256 ?? ownDigest(prior.kind, before);
        nextActions[oldIndex2] = { ...prior, clis: [.../* @__PURE__ */ new Set([...prior.clis ?? [prior.cli], ...action.clis ?? [action.cli]])], ...digest ? { blockSha256: digest } : {} };
      }
      continue;
    }
    let backup = prior?.backup;
    if (before && !prior) {
      const backups = join7(dirname3(manifestPath), "backups");
      backup = join7(backups, backupStamp, `${index}-${basename(action.path)}`);
      await ensureParents(backup, createdDirs, transaction);
      await ignoreBackups(backups, createdDirs, transaction);
      await transaction.write(backup, before);
    }
    await ensureParents(action.path, createdDirs, transaction);
    await transaction.write(action.path, after);
    const owners = [.../* @__PURE__ */ new Set([...prior?.clis ?? (prior ? [prior.cli] : []), ...action.clis ?? [action.cli]])];
    const saved = publicAction({ ...action, clis: owners }, after, backup);
    const oldIndex = nextActions.findIndex((item) => `${item.kind}:${item.path}` === key);
    if (oldIndex >= 0) nextActions[oldIndex] = saved;
    else nextActions.push(saved);
  }
  for (const action of retiring) await retireAction(action, createdDirs, transaction);
  const manifest = {
    version: 1,
    eduVersion: packageVersion(),
    installedAt: previous?.installedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    scope: plan6.scope,
    actions: nextActions,
    createdDirs,
    home: plan6.home
  };
  await ensureParents(manifestPath, createdDirs, transaction);
  manifest.createdDirs = createdDirs;
  if (sharedChanged) await saveSharedRegistry(plan6.home, shared, transaction);
  const serialized = `${JSON.stringify(manifest, null, 2)}
`;
  if ((await readTarget(manifestPath))?.toString("utf8") === serialized) return manifest;
  const temp = `${manifestPath}.${randomUUID()}.tmp`;
  await transaction.write(temp, serialized);
  await transaction.move(temp, manifestPath);
  for (const backup of legacyBackups) await transaction.remove(backup);
  return manifest;
}
function isRetired(action, retire) {
  return !action.shared && retire.some((item) => item.kind === action.kind && item.path === action.path && (!item.jsonPatch || JSON.stringify(item.jsonPatch) === JSON.stringify(action.jsonPatch)));
}
async function retireAction(action, createdDirs, transaction) {
  if (action.bundle) await validateBundleAction(action, [...transaction?.bases ?? []].map(([path, canonical]) => ({ path, canonical })));
  const write = transaction ? transaction.write.bind(transaction) : writeFile3;
  const remove = transaction ? transaction.remove.bind(transaction) : unlink;
  const current = await readTarget(action.path).catch(() => void 0);
  if (current && action.kind === "file" && action.sha256 && sha256(current) === action.sha256) {
    if (action.backup) await write(action.path, await readFile5(action.backup));
    else await remove(action.path);
  } else if (current && action.kind === "json-merge" && action.jsonPatch) {
    let remaining;
    try {
      remaining = unmergeJsonFile(action.path, current.toString("utf8"), action.jsonPatch);
    } catch {
    }
    if (remaining !== void 0 && remaining !== current.toString("utf8")) {
      if (!action.backup && isPlainJson(current.toString("utf8")) && isEmptyJson(remaining)) await remove(action.path);
      else await write(action.path, remaining);
    }
  }
  if (action.backup) await remove(action.backup).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  for (let dir = dirname3(action.path); createdDirs.includes(dir); dir = dirname3(dir)) {
    try {
      if (transaction) await transaction.removeEmptyDirectory(dir);
      else await rmdir(dir);
    } catch (error) {
      if (["ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) break;
      if (error.code !== "ENOENT") throw error;
    }
    createdDirs.splice(createdDirs.indexOf(dir), 1);
  }
}
async function uninstall(options) {
  const found = await loadManifest(options.manifestPath);
  if (!found) throw new Error(`Edu manifest not found: ${options.manifestPath}`);
  await withInstallLock(found.home ?? dirname3(dirname3(options.manifestPath)), async () => {
    const manifest = await loadManifest(options.manifestPath);
    if (!manifest) throw new Error(`Edu manifest not found: ${options.manifestPath}`);
    const transaction = new FileTransaction();
    try {
      await uninstallPrepared(manifest, options.manifestPath, Boolean(options.force), transaction);
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollback) {
        throw new AggregateError([error, rollback], "Uninstall failed and rollback incomplete");
      }
      throw error;
    }
  });
}
async function uninstallPrepared(manifest, manifestPath, force, transaction) {
  const bases = await pinConfiguredBases(manifest.actions.find((a) => a.bundle)?.bundle?.anchor ?? dirname3(dirname3(manifestPath)), manifest.home ?? dirname3(dirname3(manifestPath)));
  for (const action of manifest.actions) if (action.bundle) await validateBundleAction(action, bases);
  if (force) {
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
    if (!shared?.targets[action.path]?.owners.includes(manifestPath)) {
      throw new Error(`Missing shared ownership: ${action.path}`);
    }
  }
  if (!force) {
    for (const action of manifest.actions) {
      if (!await isActionIntact(action, await readTarget(action.path))) throw driftError(action.path);
    }
  }
  const sharedBackups = [];
  let sharedChanged = false;
  for (const action of [...manifest.actions].reverse()) {
    if (action.shared) {
      const target = shared.targets[action.path];
      target.owners = target.owners.filter((owner) => owner !== manifestPath);
      if (!target.owners.length) {
        await revertAction(action, transaction, target.sha256, target.backup);
        if (target.backup) sharedBackups.push(target.backup);
        delete shared.targets[action.path];
      }
      sharedChanged = true;
      continue;
    }
    await revertAction(action, transaction, action.sha256, action.backup);
  }
  const removeIfPresent = (path) => transaction.remove(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  for (const backup of manifest.actions.filter((action) => !action.shared).map((action) => action.backup).filter((value) => !!value)) await removeIfPresent(backup);
  await transaction.remove(manifestPath);
  const registryEmptied = sharedChanged && !Object.keys(shared.targets).length;
  if (sharedChanged) {
    await saveSharedRegistry(manifest.home, shared, transaction);
    for (const backup of sharedBackups) await removeIfPresent(backup);
  }
  const backupRoots = /* @__PURE__ */ new Set([join7(dirname3(manifestPath), "backups"), ...registryEmptied ? [join7(manifest.home, ".edu/shared-backups")] : []]);
  const dirs = [.../* @__PURE__ */ new Set([...manifest.createdDirs ?? [], ...registryEmptied ? shared.createdDirs : []])].sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    if (backupRoots.has(dir)) await dropBackupIgnore(dir, transaction);
    await transaction.removeEmptyDirectory(dir).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
    });
  }
}
async function revertAction(action, transaction, written, backup) {
  const restore = async () => {
    const original = await readTarget(backup);
    if (!original) throw new Error(`Cannot restore ${action.path}: its backup ${backup} is missing`);
    await transaction.write(action.path, original);
  };
  const current = await readTarget(action.path);
  if (!current) {
    if (backup) await restore();
    return;
  }
  if (written && sha256(current) === written) {
    if (backup) await restore();
    else await transaction.remove(action.path);
    return;
  }
  const text = current.toString("utf8");
  let remaining;
  if (action.kind === "json-merge" && action.jsonPatch) remaining = unmergeJsonFile(action.path, text, action.jsonPatch);
  else if (action.kind === "managed-block" || action.kind === "toml-merge") {
    try {
      remaining = action.kind === "managed-block" ? removeManagedBlock(text) : unmergeToml(text);
    } catch (error) {
      throw new Error(`${action.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (remaining === void 0) {
    if (backup) await restore();
    else await transaction.remove(action.path);
    return;
  }
  if (remaining === text) return;
  const empty = action.kind === "json-merge" ? isEmptyJson(remaining) : !remaining.trim();
  if (empty && !backup) await transaction.remove(action.path);
  else await transaction.write(action.path, remaining);
}
function isPlainJson(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
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
  scanTomlLines,
  tomlEnabledTables,
  UNION,
  serializeLike,
  jsoncFormatFor,
  mergeJson,
  unmergeJson,
  mergeToml,
  hasTopLevelTomlKey,
  unmergeToml,
  hostConfigDirs,
  installDirs,
  pathsFor,
  pinConfiguredBases,
  nativePath,
  samePath,
  instructionActions,
  skillActions,
  createCodexIntegration,
  createPiIntegration,
  createOpenCodeIntegration,
  createAgyIntegration,
  withInstallLock,
  isActionIntact,
  getManifestPath,
  planInstall,
  describePlan,
  applyInstall,
  uninstall,
  sha256,
  readTarget,
  FileTransaction,
  validateBundleAction,
  createClaudeIntegration
};
//# sourceMappingURL=chunk-QBTHH6SX.js.map