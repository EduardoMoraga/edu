// src/skills/bundle.ts
import { createHash } from "crypto";
import { access, lstat, readFile, stat, realpath } from "fs/promises";
import { constants } from "fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { isMap, isScalar, parseDocument } from "yaml";
import { z } from "zod";
var BUNDLE_LIMITS = { files: 64, fileBytes: 256 * 1024, totalBytes: 1024 * 1024, documentBytes: 64 * 1024 };
var hash = (value) => createHash("sha256").update(value).digest("hex");
var Host = z.enum(["claude", "codex", "pi", "opencode", "agy"]);
var BundleMetadataSchema = z.object({
  files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()).max(BUNDLE_LIMITS.files - 1).default([]),
  requires: z.array(z.string().regex(/^[a-zA-Z0-9][\w.-]*$/)).max(16).default([]),
  hosts: z.array(Host).min(1).max(5).optional(),
  references: z.array(z.string()).max(64).default([]),
  evidence: z.array(z.string().min(1).max(200)).max(32).default([])
}).strict();
var ProposalBundleSchema = z.object({
  files: z.record(z.string(), z.string()).optional(),
  evidence: z.array(z.string().min(1).max(200)).max(32).optional(),
  hashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
  checks: z.array(z.object({ id: z.string().min(1).max(200), ok: z.boolean(), evidence: z.array(z.string().min(1).max(200)).max(32) }).strict()).max(32).optional()
});
function portablePath(path) {
  const parts = path.split("/");
  if (path.length > 200 || parts.length > 12 || parts.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part) || part.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Invalid portable bundle path: ${path}`);
  return path;
}
var UnsupportedSkillPathError = class extends Error {
};
var UnsupportedSkillEncodingError = class extends Error {
};
async function canonicalAnchor(anchor) {
  try {
    return await realpath(anchor);
  } catch (error) {
    if (error.code !== "ENOENT" || dirname(anchor) === anchor) throw error;
    return join(await canonicalAnchor(dirname(anchor)), relative(dirname(anchor), anchor));
  }
}
async function assertContained(anchor, target, pinnedCanonical) {
  const lexicalRoot = resolve(anchor), path = resolve(target), rel = relative(lexicalRoot, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Bundle path escapes containment: ${target}`);
  const root = await canonicalAnchor(lexicalRoot);
  if (pinnedCanonical !== void 0 && root !== pinnedCanonical) throw new Error(`Configured base identity changed (symlink/alias retarget): ${anchor}`);
  let current = root;
  const parts = rel ? rel.split(sep) : [];
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = join(current, parts[i]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile() || i < parts.length - 1 && !info.isDirectory()) throw new UnsupportedSkillPathError(`Refusing symlink or non-regular bundle path: ${current}`);
      const actual = await realpath(current), actualRel = relative(root, actual);
      if (actualRel === ".." || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new Error(`Bundle path escapes real containment: ${current}`);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}
async function commandAvailable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]) {
      try {
        const path = join(directory, name + extension);
        if (!(await stat(path)).isFile()) continue;
        await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}
function text(value, path, limit = BUNDLE_LIMITS.fileBytes) {
  if (typeof value !== "string" || Buffer.byteLength(value) > limit || value.includes("\0") || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value)) !== value) throw new Error(`Invalid UTF-8 or oversized bundle file: ${path}`);
  return value;
}
function metadata(name, content, strict = false) {
  portablePath(name);
  if (name.includes("/")) throw new Error("Skill name must be a single portable segment.");
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(content);
  const header = /^---\s*\r?\n/.test(content) ? match?.[1] ?? content : "";
  const document = parseDocument(header);
  let declared = isMap(document.contents) && document.contents.items.some((item) => isScalar(item.key) && item.key.value === "bundle");
  let front;
  if (document.errors.length) {
    const indent = /^([ \t]*)[\w"'][^\r\n]*?:/m.exec(header)?.[1] ?? "";
    declared ||= header.split(/\r?\n/).some((line) => line.startsWith(indent) && /^(?:bundle|"bundle"|'bundle')[ \t]*:/.test(line.slice(indent.length)));
    if (strict || declared) throw document.errors[0];
  } else front = document.toJS();
  const value = front && typeof front === "object" && !Array.isArray(front) ? front : {};
  if (strict || declared) {
    text(content, "SKILL.md", BUNDLE_LIMITS.documentBytes);
    if (!match || value.name !== name || typeof value.description !== "string" || !value.description.trim() || !match[2].trim()) throw new Error("Invalid skill: matching name, description and nonempty body are required.");
  }
  return { bundle: BundleMetadataSchema.parse(value.bundle ?? {}), declared };
}
function prose(content) {
  let fence;
  return content.split(/\r?\n/).map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = void 0;
      return "";
    }
    return fence ? "" : line.replace(/(`+)[\s\S]*?\1/g, "");
  }).join("\n");
}
async function validateSkillBundle(input, options = {}) {
  const { bundle: meta, declared } = metadata(input.name, input.content, options.strictDocument);
  const files = [{ path: "SKILL.md", content: input.content, sha256: hash(input.content) }];
  const names = /* @__PURE__ */ new Set(["skill.md"]);
  let bytes = Buffer.byteLength(input.content);
  for (const declared2 of meta.files) {
    const path = portablePath(declared2.path), key = path.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate bundle path: ${path}`);
    names.add(key);
    const content = input.files?.[path];
    if (content === void 0) throw new Error(`Missing declared bundle file: ${path}`);
    text(content, path);
    bytes += Buffer.byteLength(content);
    const sha256 = hash(content);
    if (declared2.sha256 && declared2.sha256 !== sha256) throw new Error(`Bundle hash mismatch: ${path}`);
    files.push({ path, content, sha256 });
  }
  for (const a of names) for (const b of names) if (a !== b && b.startsWith(a + "/")) throw new Error(`Bundle file conflicts with parent path: ${a}`);
  if ((declared || options.strictDocument) && bytes > BUNDLE_LIMITS.totalBytes) throw new Error("Bundle exceeds total byte limit.");
  for (const path of Object.keys(input.files ?? {})) if (!meta.files.some((file) => file.path === path)) throw new Error(`Undeclared bundle file: ${path}`);
  const references = [...meta.references, ...declared ? Array.from(prose(input.content).matchAll(/\]\(([^\s)]+)\)/g), (m) => m[1]) : []].filter((path) => !/^(?:[a-z]+:|#)/i.test(path));
  for (const reference of references) {
    const path = portablePath(reference.replace(/^\.\//, "").split("#")[0]);
    if (!files.some((file) => file.path === path)) throw new Error(`Missing declared bundle reference: ${reference}`);
  }
  if (options.host && meta.hosts && !meta.hosts.includes(options.host)) throw new Error(`Skill ${input.name} does not support host ${options.host}`);
  for (const requirement of options.checkRequirements === false ? [] : meta.requires) if (!await (options.hasCommand ?? commandAvailable)(requirement)) throw new Error(`Missing bundle requirement: ${requirement}`);
  return { name: input.name, metadata: meta, files };
}
async function readSkillBundle(directory, name, options = {}) {
  const read = async (path) => {
    await assertContained(options.anchor ?? directory, join(directory, path));
    const file = join(directory, path), stat3 = await lstat(file);
    if (!stat3.isFile() || path !== "SKILL.md" && stat3.size > BUNDLE_LIMITS.fileBytes) throw new Error(`Non-regular or oversized bundle file: ${file}`);
    const bytes = await readFile(file);
    let value;
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      if (path === "SKILL.md" && (options.strictDocument || metadata(name, bytes.toString("utf8")).declared)) throw new Error(`Invalid UTF-8 declared skill document: ${file}`);
      if (path === "SKILL.md") throw new UnsupportedSkillEncodingError(`Unsupported skill document encoding (UTF-8 required): ${file}`);
      throw new Error(`Invalid UTF-8 bundle resource: ${file}`);
    }
    if (path === "SKILL.md" && value.includes("\0")) {
      if (options.strictDocument || metadata(name, value).declared) throw new Error(`Invalid declared skill document encoding: ${file}`);
      throw new UnsupportedSkillEncodingError(`Unsupported skill document encoding (NUL/UTF-16): ${file}`);
    }
    return path === "SKILL.md" ? value : text(value, path);
  };
  const content = await read("SKILL.md"), { bundle: meta } = metadata(name, content, options.strictDocument);
  const files = {};
  for (const declared of meta.files) files[portablePath(declared.path)] = await read(declared.path);
  return validateSkillBundle({ name, content, files }, options);
}

// src/adapters/paths.ts
import { join as join2, resolve as resolve2, sep as sep2 } from "path";
function pathsFor(cli, scope, root, home) {
  const project = scope === "project";
  const sharedSkills = join2(project ? root : home, ".agents/skills");
  switch (cli) {
    case "claude": {
      const base = join2(project ? root : home, ".claude");
      return {
        instructions: [join2(project ? root : base, "CLAUDE.md")],
        skills: join2(base, "skills"),
        agents: join2(base, "agents"),
        mcp: join2(project ? root : home, project ? ".mcp.json" : ".claude.json"),
        settings: join2(base, "settings.json"),
        outputStyle: join2(base, "output-styles/edu.md")
      };
    }
    case "codex":
      return {
        instructions: [join2(project ? root : join2(home, ".codex"), "AGENTS.md")],
        skills: sharedSkills,
        mcp: join2(home, ".codex/config.toml")
      };
    case "pi":
      return {
        instructions: [join2(project ? root : join2(home, ".pi/agent"), "AGENTS.md")],
        skills: sharedSkills,
        mcp: join2(home, ".pi/agent/mcp.json")
      };
    case "opencode":
      return {
        instructions: [join2(project ? root : join2(home, ".config/opencode"), "AGENTS.md")],
        skills: sharedSkills,
        mcp: join2(project ? root : join2(home, ".config/opencode"), "opencode.json")
      };
    case "agy":
      return {
        instructions: project ? [join2(root, "GEMINI.md"), join2(root, "AGENTS.md")] : [join2(home, ".gemini/GEMINI.md"), join2(home, ".gemini/AGENTS.md")],
        skills: sharedSkills
      };
  }
}
function configuredBases(root, home) {
  return [...new Set([root, home].flatMap((base) => [resolve2(base), ...[".edu", ".agents", ".claude"].map((name) => resolve2(base, name))]).concat([".codex", ".pi", ".config/opencode", ".gemini"].map((name) => resolve2(home, name))))];
}
async function pinConfiguredBases(root, home) {
  return Promise.all(configuredBases(root, home).map(async (path) => ({ path, canonical: await canonicalAnchor(path) })));
}
function baseFor(path, pins) {
  const target = resolve2(path);
  return pins.filter((pin) => target === pin.path || target.startsWith(pin.path + sep2)).sort((a, b) => b.path.length - a.path.length)[0];
}

// src/adapters/common.ts
import { access as access2, readdir, readFile as readFile2, stat as stat2, lstat as lstat2 } from "fs/promises";
import { constants as constants2 } from "fs";
import { delimiter as delimiter2, join as join3 } from "path";
async function binaryOnPath(binary) {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter2)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const target = join3(dir, `${binary}${extension}`);
      try {
        if (!(await stat2(target)).isFile()) continue;
        await access2(target, process.platform === "win32" ? constants2.F_OK : constants2.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}
function protocol(scope, home, brainRoot) {
  const pointer = scope === "project" ? "@.edu/EDU.md" : `@${join3(brainRoot ?? join3(home, ".edu"), "EDU.md")}`;
  return `${pointer}
1. Reuse an injected Edu brief; call \`edu_brief\` only if absent or explicitly refreshing.
2. Retain an injected Edu session id; only if absent, \`edu_session_open\` (title, source) and keep its exact returned id per workspace.
3. Recall on demand with \`edu_recall\`, then \`edu_read\`; cite ids, scope, claim bands and evidence.
4. Record decisions and lessons with \`edu_remember\`. Memory is stored notes, not model training. \`edu_feedback\` is advisory, never proof that a lesson is proven. Check \`edu_capabilities\` for the installed version; unavailable means unknown.
5. Close with \`edu_session_close\` using that exact id and a summary. Optionally include up to 3 durable \`lessons\` ({title, body, evidence:[existing ids]}); they are candidate/inferred observations, never verified facts. Do not invent a lesson or run another model to extract it. Report what remains open; never invent an id or claim closure after failure.
Tool names are logical names: in Pi discover \`mcp__edu__edu_*\` through codemode/tool_search as needed. Pi requests a host-owned workspace lock: change the host cwd and restart MCP rather than switching only with \`edu_project_use\`. Other clients may allow that tool: verify scope and retain separate session ids. Use crew only for independent work, substantial review or an explicit request; do not spawn extra agents for every trivial task.`;
}
function instructionActions(cli, scope, root, options) {
  return pathsFor(cli, scope, root, options.home).instructions.map((path) => ({
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
  const brain = join3(scope === "project" ? root : options.home, ".edu/skills");
  const sources = [{ root: join3(options.templatesDir, "skills"), anchor: options.templatesDir }, { root: brain, custom: true, anchor: join3(scope === "project" ? root : options.home, ".edu") }];
  const skills = /* @__PURE__ */ new Map();
  for (const source of sources) {
    const sourceCanonical = await canonicalAnchor(source.anchor);
    try {
      await lstat2(source.root);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    try {
      await assertContained(source.anchor, source.root);
      if (!(await lstat2(source.root)).isDirectory()) throw new UnsupportedSkillPathError(`Non-directory skill source: ${source.root}`);
    } catch (error) {
      if (!source.custom || !(error instanceof UnsupportedSkillPathError)) throw error;
      skills.clear();
      options.notes?.push(`Skipped custom skill source ${source.root}: ${error.message}; builtin skills also skipped because overrides cannot be inspected.`);
      continue;
    }
    for (const name of (await readdir(source.root)).sort()) {
      if (!/^[a-zA-Z0-9][\w-]*$/.test(name)) continue;
      const directory = join3(source.root, name), file = join3(directory, "SKILL.md");
      if (source.custom) {
        try {
          await assertContained(source.anchor, directory);
          await assertContained(source.anchor, file);
          try {
            if (!(await lstat2(file)).isFile()) throw new UnsupportedSkillPathError(`Non-regular skill document: ${file}`);
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
        await lstat2(file);
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
      const destinationBase = join3(scope === "project" ? root : options.home, cli === "claude" ? ".claude" : ".agents");
      const destinationPin = baseFor(destinationBase, bases);
      skills.set(name, bundle.files.map((file2) => ({
        cli,
        kind: "file",
        path: join3(destination, name, file2.path),
        description: `Install ${name} skill bundle ${file2.path}`,
        content: file2.content,
        bundle: {
          name,
          bases,
          base: destinationPin,
          root: join3(destination, name),
          anchor: scope === "project" ? root : options.home,
          scope,
          relative: file2.path,
          source: { path: join3(directory, file2.path), anchor: source.anchor, canonical: sourceCanonical, sha256: file2.sha256 }
        }
      })));
    }
  }
  return [...skills.values()].flat();
}
async function agentTemplates(templatesDir) {
  const dir = join3(templatesDir, "agents");
  const result = [];
  for (const filename of (await readdir(dir)).filter((name) => name.endsWith(".md")).sort()) {
    const text2 = await readFile2(join3(dir, filename), "utf8");
    const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text2);
    if (!parts) throw new Error(`Malformed agent template: ${filename}`);
    const fields = Object.fromEntries(parts[1].split("\n").map((line) => {
      const index = line.indexOf(":");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
    const name = fields.id;
    if (!name || !/^[\w-]+$/.test(name)) throw new Error(`Invalid agent template: ${filename}`);
    result.push({ name, description: fields.mission ?? fields.title ?? name, tools: fields.autonomy === "readonly" ? "Read, Grep, Glob" : "Read, Write, Edit, Bash, Grep, Glob", prompt: parts[2].trim() });
  }
  return result;
}

export {
  ProposalBundleSchema,
  portablePath,
  canonicalAnchor,
  assertContained,
  validateSkillBundle,
  pathsFor,
  configuredBases,
  pinConfiguredBases,
  baseFor,
  binaryOnPath,
  instructionActions,
  skillActions,
  agentTemplates
};
//# sourceMappingURL=chunk-HITNXL4T.js.map