import {
  brainPath
} from "./chunk-YPR7PZSQ.js";
import {
  TIER_DIRS,
  TRANSITIVE_PREFIX,
  parseFrontmatter,
  serializeMarkdown
} from "./chunk-VP6QM6H5.js";

// src/brain/local-dir.ts
import { createHash } from "crypto";
import { realpathSync } from "fs";
import { appendFile, readFile, writeFile } from "fs/promises";
import { join as join2, resolve as resolve2 } from "path";

// src/brain/safe-path.ts
import { lstat, realpath } from "fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "path";
var UnsafeBrainPathError = class extends Error {
  code = "unsafe-brain-path";
  constructor(message) {
    super(message);
    this.name = "UnsafeBrainPathError";
  }
};
var isUnsafeBrainPath = (error) => error instanceof UnsafeBrainPathError;
var below = (base, path) => {
  const rel = relative(base, path);
  return rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) ? void 0 : rel;
};
var canonicalRoots = /* @__PURE__ */ new Map();
async function canonicalRoot(root, fresh = false) {
  const key = resolve(root);
  if (!fresh && canonicalRoots.has(key)) return canonicalRoots.get(key);
  try {
    const real = await realpath(key);
    canonicalRoots.set(key, real);
    return real;
  } catch {
    return void 0;
  }
}
async function assertInsideBrain(root, path) {
  const target = resolve(path);
  let base = resolve(root);
  let rel = below(base, target);
  if (rel === void 0) {
    for (const fresh of [false, true]) {
      const real = await canonicalRoot(root, fresh);
      if (real && (rel = below(real, target)) !== void 0) {
        base = real;
        break;
      }
    }
  }
  if (rel === void 0) {
    const real = await canonicalRoot(root, true);
    for (let dir = resolve(target, ".."); real && rel === void 0; dir = resolve(dir, "..")) {
      if (await realpath(dir).catch(() => void 0) === real) {
        base = dir;
        rel = below(dir, target);
      }
      if (resolve(dir, "..") === dir) break;
    }
  }
  if (rel === void 0) throw new UnsafeBrainPathError(`refusing to write ${path}: it is outside the brain ${root}`);
  const parts = rel.split(sep);
  let current = base;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    const stat2 = await lstat(current).catch((error) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return void 0;
      throw error;
    });
    if (!stat2) return;
    if (stat2.isSymbolicLink()) {
      throw new UnsafeBrainPathError(`refusing to write ${parts.join("/")}: ${parts.slice(0, i + 1).join("/")} is a symbolic link inside the brain ${root}`);
    }
  }
}

// src/brain/local-dir.ts
var LOCAL_DIR = ".edu-local";
function folderKey(path, platform = process.platform) {
  let real;
  try {
    real = realpathSync.native(path);
  } catch {
    real = resolve2(path);
  }
  return createHash("sha256").update(platform === "win32" ? real.toLowerCase() : real).digest("hex").slice(0, 24);
}
async function safeLocalTarget(root, path, quiet = false) {
  try {
    await assertInsideBrain(root, path);
    return true;
  } catch (error) {
    if (!isUnsafeBrainPath(error)) throw error;
    if (!quiet) process.emitWarning(`${error.message}; skipped`, "EduWarning");
    return false;
  }
}
var ignored = /* @__PURE__ */ new Set();
async function ensureLocalIgnored(root) {
  const key = resolve2(root);
  if (ignored.has(key)) return;
  const path = join2(root, ".gitignore");
  if (!await safeLocalTarget(root, path)) return;
  const current = await readFile(path, "utf8").catch(() => void 0);
  const rules = (current ?? "").split(/\r?\n/).map((line) => line.trim());
  if (!rules.some((rule) => [LOCAL_DIR, `${LOCAL_DIR}/`, `/${LOCAL_DIR}`, `/${LOCAL_DIR}/`].includes(rule))) {
    if (current === void 0) await writeFile(path, `${LOCAL_DIR}/
`, { flag: "wx" }).catch((error) => {
      if (error.code === "EEXIST") return appendFile(path, `${LOCAL_DIR}/
`);
      throw error;
    });
    else await appendFile(path, `${current && !current.endsWith("\n") ? "\n" : ""}${LOCAL_DIR}/
`);
  }
  ignored.add(key);
}

// src/brain/store.ts
import { copyFile, link, mkdir as mkdir2, readFile as readFile3, readdir, rename as rename2, rm as rm2, stat, writeFile as writeFile3 } from "fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute2, relative as relative2, resolve as resolve3, join as join4 } from "path";
import { createHash as createHash2, randomUUID as randomUUID2 } from "crypto";

// src/brain/note-schema.ts
import { z } from "zod";
var TEXT_ERROR = "must be text, not a list or a map";
var scalarText = z.union([z.string(), z.number(), z.boolean(), z.bigint()], { error: TEXT_ERROR }).transform(String);
var absent = (value) => value === null ? void 0 : value;
var optionalText = z.preprocess(absent, scalarText.optional());
var requiredText = z.preprocess(absent, z.union([z.string(), z.number(), z.boolean(), z.bigint()], {
  error: (issue) => issue.input === void 0 ? "is missing" : TEXT_ERROR
}).transform(String).refine((value) => value.trim().length > 0, "is empty"));
var asList = (value) => Array.isArray(value) ? value.filter((item) => item !== null && item !== void 0) : typeof value === "object" && value !== null ? value : [value];
var textList = z.preprocess((value) => value === null || value === void 0 ? [] : asList(value), z.array(scalarText, { error: "must be a list of text" }));
var optionalList = z.preprocess((value) => value === null || value === void 0 ? void 0 : asList(value), z.array(scalarText, { error: "must be a list of text" }).optional());
var optionalMap = z.preprocess(absent, z.record(z.string(), z.unknown(), { error: "must be a map" }).optional());
var TEXT_KEYS = [
  "kind",
  "status",
  "band",
  "created",
  "updated",
  "source",
  "owner",
  "stakeholder",
  "due",
  "supersedes",
  "superseded_by",
  "legacy_id",
  "origin",
  "import_warning",
  "host",
  "agent",
  "session"
];
var noteMetaSchema = z.looseObject({
  id: requiredText,
  tier: z.preprocess(absent, z.enum(["canonical", "episodic", "transitive"], {
    error: (issue) => issue.input === void 0 ? "is missing" : "must be canonical, episodic or transitive"
  })),
  title: requiredText,
  ...Object.fromEntries(TEXT_KEYS.map((key) => [key, optionalText])),
  tags: textList,
  links: textList,
  aliases: optionalList,
  usage: optionalMap,
  albert: optionalMap
});
var firstLine = (error) => (error instanceof Error ? error.message : String(error)).split("\n", 1)[0].slice(0, 160);
function validateMeta(raw, fallbackCreated) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problem: "frontmatter is not a map of fields" };
  const result = noteMetaSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "frontmatter"} ${issue.message}`);
    return { problem: issues.join("; ") };
  }
  const meta = Object.fromEntries(Object.entries(result.data).filter(([, value]) => value !== void 0));
  if (!meta.created) meta.created = fallbackCreated;
  return { meta };
}
function readNoteSource(source, fallbackCreated) {
  let parsed;
  try {
    parsed = parseFrontmatter(source);
  } catch (error) {
    return { problem: `invalid YAML frontmatter: ${firstLine(error)}` };
  }
  if (!parsed) return { problem: "no frontmatter (a note needs id, tier and title)" };
  const checked = validateMeta(parsed.meta, fallbackCreated);
  return "problem" in checked ? checked : { meta: checked.meta, body: parsed.body };
}

// src/brain/note-cache.ts
import { randomUUID } from "crypto";
import { access, mkdir, readFile as readFile2, rename, rm, writeFile as writeFile2 } from "fs/promises";
import { dirname, join as join3 } from "path";
var NOTE_CACHE_FILE = "notes-cache.json";
var FORMAT = 1;
var noteCachePath = (root) => join3(root, LOCAL_DIR, NOTE_CACHE_FILE);
var isEntry = (value) => {
  const entry = value;
  if (!entry || typeof entry !== "object" || typeof entry.mtimeMs !== "number" || typeof entry.size !== "number" || typeof entry.ino !== "number") return false;
  if (typeof entry.problem === "string") return entry.note === void 0;
  const note = entry.note;
  return Boolean(note && typeof note.body === "string" && note.meta && typeof note.meta === "object" && typeof note.meta.id === "string" && typeof note.meta.tier === "string" && typeof note.meta.title === "string" && Array.isArray(note.meta.tags) && Array.isArray(note.meta.links) && typeof note.meta.created === "string");
};
async function loadNoteCache(root) {
  const entries = /* @__PURE__ */ new Map();
  const path = noteCachePath(root);
  try {
    if (!await safeLocalTarget(root, path, true)) return entries;
    const raw = JSON.parse(await readFile2(path, "utf8"));
    if (raw?.format !== FORMAT || !raw.entries || typeof raw.entries !== "object") return entries;
    for (const [file, entry] of Object.entries(raw.entries)) if (isEntry(entry)) entries.set(file, entry);
  } catch {
  }
  return entries;
}
async function saveNoteCache(root, entries) {
  const path = noteCachePath(root);
  try {
    await access(root);
    if (!await safeLocalTarget(root, path, true)) return false;
    await ensureLocalIgnored(root);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile2(temp, JSON.stringify({ format: FORMAT, entries: Object.fromEntries(entries) }), "utf8");
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true }).catch(() => {
      });
    }
    return true;
  } catch {
    return false;
  }
}

// src/brain/store.ts
var MAX_SLUG = 80;
var LATIN_LETTERS = { \u00DF: "ss", \u00E6: "ae", \u00F8: "o", \u0153: "oe", \u0142: "l", \u0111: "d", \u00F0: "d", \u00FE: "th", \u0131: "i", \u0127: "h", \u0167: "t", \u014B: "n" };
var WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
function slugify(value) {
  const folded = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[ßæøœłđðþıħŧŋ]/g, (letter) => LATIN_LETTERS[letter]);
  const slug = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const unspelled = /[\p{L}\p{N}]/u.test(folded.replace(/[\x00-\x7f]+/g, ""));
  if (!unspelled && slug.length <= MAX_SLUG) return !slug ? "note" : WINDOWS_RESERVED.test(slug) ? `${slug}-note` : slug;
  const hash = createHash2("sha256").update(value.normalize("NFC")).digest("hex").slice(0, 8);
  const head = slug.slice(0, MAX_SLUG - hash.length - 1).replace(/-+$/, "");
  return head ? `${head}-${hash}` : hash;
}
function legacyStem(meta) {
  if (meta.tier !== "transitive" || !meta.legacy_id) return void 0;
  const prefix = TRANSITIVE_PREFIX[meta.kind ?? "lesson"];
  const match = /^([A-Z])-(\d+)$/.exec(meta.legacy_id);
  if (!prefix || !match || `${match[1]}-` !== prefix) return void 0;
  return `${prefix}${match[2]}-${slugify(meta.title)}`;
}
function createId(meta, date = /* @__PURE__ */ new Date()) {
  if (meta.tier === "episodic") return `${date.toISOString().slice(0, 10)}-${slugify(meta.title)}-${randomUUID2().slice(0, 8)}`;
  const legacy = legacyStem(meta);
  if (legacy) return legacy;
  const prefix = meta.tier === "canonical" ? "K-" : TRANSITIVE_PREFIX[meta.kind ?? "lesson"];
  return `${prefix}${slugify(meta.title)}`;
}
function notePath(brain, meta, now = /* @__PURE__ */ new Date()) {
  let path;
  if (meta.tier === "canonical") {
    const canonicalKinds = ["identity", "standard", "lexicon", "domain", "person", "preference"];
    if (meta.kind && !canonicalKinds.includes(meta.kind)) throw new Error(`Invalid canonical kind: ${meta.kind}`);
    path = join4(brain, TIER_DIRS.canonical, slugify(String(meta.kind ?? "domain")), `${slugify(meta.title)}.md`);
  } else if (meta.tier === "episodic") {
    const stamp = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 16).replace(":", "")}`;
    const suffix = /-([a-f0-9]{8})$/.exec(meta.id)?.[1];
    path = join4(brain, TIER_DIRS.episodic, `${stamp}_${slugify(meta.title)}${suffix ? `-${suffix}` : ""}.md`);
  } else {
    const prefix = TRANSITIVE_PREFIX[meta.kind];
    if (!prefix) throw new Error(`Invalid transitive kind: ${String(meta.kind)}`);
    path = join4(brain, TIER_DIRS.transitive, `${legacyStem(meta) === meta.id ? meta.id : `${prefix}${slugify(meta.title)}`}.md`);
  }
  const base = resolve3(brain);
  const resolved = resolve3(path);
  const rel = relative2(base, resolved);
  if (isAbsolute2(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Brain note path escapes the brain root");
  return resolved;
}
var atomicFs = {
  mkdir: mkdir2,
  writeFile: writeFile3,
  rename: rename2,
  copyFile,
  rm: rm2,
  link,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms))
};
var LOCKED = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES"]);
var RENAME_BACKOFF_MS = [10, 20, 40, 80, 160, 320, 400, 400, 400];
var isLocked = (error) => LOCKED.has(String(error?.code));
async function atomicWrite(path, content, options = {}) {
  if (options.root !== void 0) await assertInsideBrain(options.root, path);
  noteCache.delete(resolve3(path));
  await atomicFs.mkdir(dirname2(path), { recursive: true });
  const temp = `${path}.${randomUUID2()}.tmp`;
  try {
    await atomicFs.writeFile(temp, content, "utf8");
    for (let attempt = 0; ; attempt++) {
      try {
        await atomicFs.rename(temp, path);
        return;
      } catch (error) {
        if (!isLocked(error)) throw error;
        const delay = RENAME_BACKOFF_MS[attempt];
        if (delay === void 0) {
          try {
            await atomicFs.copyFile(temp, path);
            return;
          } catch {
            throw error;
          }
        }
        await atomicFs.sleep(delay);
      }
    }
  } finally {
    await atomicFs.rm(temp, { force: true }).catch(() => {
    });
  }
}
var NO_HARD_LINKS = /* @__PURE__ */ new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EACCES"]);
async function exclusiveWrite(path, content, options = {}) {
  if (options.root !== void 0) await assertInsideBrain(options.root, path);
  noteCache.delete(resolve3(path));
  await atomicFs.mkdir(dirname2(path), { recursive: true });
  const temp = `${path}.${randomUUID2()}.tmp`;
  try {
    await atomicFs.writeFile(temp, content, "utf8");
    try {
      await atomicFs.link(temp, path);
    } catch (error) {
      if (!NO_HARD_LINKS.has(String(error.code))) throw error;
      await atomicFs.writeFile(path, content, { encoding: "utf8", flag: "wx" });
    }
  } finally {
    await atomicFs.rm(temp, { force: true }).catch(() => {
    });
  }
}
var PathTakenError = class extends Error {
  code = "EEXIST";
  constructor(message) {
    super(message);
    this.name = "PathTakenError";
  }
};
var isAlreadyExists = (error) => error?.code === "EEXIST";
var noteCache = /* @__PURE__ */ new Map();
var diskCaches = /* @__PURE__ */ new Map();
var savedCaches = /* @__PURE__ */ new Set();
var noteParses = 0;
var locationListings = 0;
var handOut = (entry, path) => entry.note ? { note: { meta: structuredClone(entry.note.meta), body: entry.note.body, path } } : { problem: entry.problem ?? "unreadable" };
var sameFile = (entry, info) => entry !== void 0 && entry.mtimeMs === info.mtimeMs && entry.size === info.size && entry.ino === info.ino;
function normalizeLegacyMeta(meta) {
  if (meta.kind !== "decision" || meta.status !== "reverted" || !meta.supersedes || meta.superseded_by) return meta;
  const { supersedes, ...rest } = meta;
  return { ...rest, superseded_by: supersedes };
}
async function inspectNote(path, disk) {
  const key = resolve3(path);
  try {
    const info = await stat(path);
    const cached = noteCache.get(key);
    if (sameFile(cached, info)) return handOut(cached, path);
    const stored = disk?.get(key);
    if (sameFile(stored, info)) {
      noteCache.set(key, stored);
      return handOut(stored, path);
    }
    const source = await readFile3(path, "utf8");
    noteParses++;
    const read = readNoteSource(source, new Date(info.mtimeMs).toISOString());
    const entry = {
      mtimeMs: info.mtimeMs,
      size: info.size,
      ino: info.ino,
      ..."problem" in read ? { problem: read.problem } : { note: { meta: normalizeLegacyMeta(read.meta), body: read.body } }
    };
    noteCache.set(key, entry);
    return handOut(entry, path);
  } catch {
    noteCache.delete(key);
    return void 0;
  }
}
async function readNote(path) {
  const read = await inspectNote(path);
  return read && "note" in read ? read.note : void 0;
}
async function markdownFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths = [];
  for (const entry of entries) {
    const path = join4(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.endsWith(".base.md")) paths.push(path);
  }
  return paths;
}
async function inspectAll(paths, disk) {
  const results = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < paths.length; index = next++) results[index] = await inspectNote(paths[index], disk);
  };
  await Promise.all(Array.from({ length: Math.min(32, paths.length) }, worker));
  return results;
}
async function scanLocation(location) {
  const brain = brainPath(location);
  const paths = (await Promise.all([TIER_DIRS.canonical, TIER_DIRS.episodic, TIER_DIRS.transitive].map((dir) => markdownFiles(join4(brain, dir))))).flat();
  const root = resolve3(location.root);
  let disk = diskCaches.get(root);
  if (!disk) {
    disk = await loadNoteCache(root);
    diskCaches.set(root, disk);
  }
  const read = await inspectAll(paths, disk);
  const notes = [], problems = [];
  const current = /* @__PURE__ */ new Map();
  read.forEach((result, index) => {
    const path = paths[index];
    if (!result) return;
    if ("note" in result) notes.push(result.note);
    else problems.push({ path, problem: result.problem, scope: location.scope });
    const entry = noteCache.get(resolve3(path));
    if (entry) current.set(resolve3(path), entry);
  });
  if (!savedCaches.has(root) && (current.size || disk.size) && (current.size !== disk.size || [...current].some(([key, entry]) => !sameFile(disk.get(key), entry)))) {
    savedCaches.add(root);
    if (await saveNoteCache(root, current)) diskCaches.set(root, current);
  }
  locationListings++;
  return { notes, problems };
}
async function listLocation(location) {
  return (await scanLocation(location)).notes;
}
async function overlayScan(locations) {
  const byId = /* @__PURE__ */ new Map();
  const problems = [];
  for (const location of [...locations].reverse()) {
    const scan = await scanLocation(location);
    for (const note of scan.notes) byId.set(note.meta.id, note);
    problems.unshift(...scan.problems);
  }
  return { notes: [...byId.values()], problems };
}
function overlay(lists) {
  const byId = /* @__PURE__ */ new Map();
  for (const list of [...lists].reverse()) for (const note of list) byId.set(note.meta.id, note);
  return [...byId.values()];
}
async function overlayNotes(locations) {
  return (await overlayScan(locations)).notes;
}
function encodeNote(note) {
  return serializeMarkdown(note.meta, note.body);
}
var VOLATILE_KEYS = /* @__PURE__ */ new Set(["usage", "updated"]);
var canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
};
function contentHash(note) {
  const meta = Object.fromEntries(Object.entries(note.meta).filter(([key]) => !VOLATILE_KEYS.has(key)));
  const body = note.body.replace(/\r\n/g, "\n").trim();
  return createHash2("sha256").update(JSON.stringify({ meta: canonicalJson(meta), body })).digest("hex").slice(0, 12);
}
var NoteConflictError = class extends Error {
  constructor(id, expectedHash, currentHash) {
    super(`Note ${id} changed since it was read (expected ${expectedHash}, current ${currentHash}); re-read it and retry`);
    this.id = id;
    this.expectedHash = expectedHash;
    this.currentHash = currentHash;
    this.name = "NoteConflictError";
  }
  id;
  expectedHash;
  currentHash;
  code = "note-conflict";
};

export {
  isUnsafeBrainPath,
  assertInsideBrain,
  LOCAL_DIR,
  folderKey,
  safeLocalTarget,
  ensureLocalIgnored,
  slugify,
  createId,
  notePath,
  atomicWrite,
  exclusiveWrite,
  PathTakenError,
  isAlreadyExists,
  inspectNote,
  readNote,
  listLocation,
  overlayScan,
  overlay,
  overlayNotes,
  encodeNote,
  contentHash,
  NoteConflictError
};
//# sourceMappingURL=chunk-YINGR2DA.js.map