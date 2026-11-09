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
    const file = join(directory, path), stat2 = await lstat(file);
    if (!stat2.isFile() || path !== "SKILL.md" && stat2.size > BUNDLE_LIMITS.fileBytes) throw new Error(`Non-regular or oversized bundle file: ${file}`);
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

export {
  ProposalBundleSchema,
  portablePath,
  UnsupportedSkillPathError,
  UnsupportedSkillEncodingError,
  canonicalAnchor,
  assertContained,
  validateSkillBundle,
  readSkillBundle
};
//# sourceMappingURL=chunk-C4BNEOC5.js.map