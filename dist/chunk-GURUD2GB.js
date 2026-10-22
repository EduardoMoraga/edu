import {
  brainPath
} from "./chunk-YPR7PZSQ.js";

// src/core/contracts.ts
var TIER_DIRS = {
  canonical: "1-canonical",
  episodic: "2-episodic",
  transitive: "3-transitive"
};
var INDEX_DIR = "0-index";
var TRANSITIVE_PREFIX = {
  decision: "D-",
  hypothesis: "H-",
  commitment: "C-",
  lesson: "L-"
};

// src/brain/frontmatter.ts
import { parse, stringify } from "yaml";
function parseMarkdown(source) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized.trimEnd() };
  const meta = parse(match[1] ?? "") ?? {};
  return { meta, body: (match[2] ?? "").trim() };
}
function serializeMarkdown(meta, body) {
  const yaml = stringify(meta, { lineWidth: 0 }).trimEnd();
  return `---
${yaml}
---

${body.trim()}
`;
}
function parseMarkdownLenient(source) {
  try {
    return { ...parseMarkdown(source), recovered: false };
  } catch {
    const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
    if (!match) throw new Error("Unparseable frontmatter");
    const meta = {};
    let lastKey;
    for (const line of (match[1] ?? "").split("\n")) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (pair) {
        lastKey = pair[1];
        meta[lastKey] = flatValue(pair[2].trim());
      } else if (lastKey && /^\s+\S/.test(line) && typeof meta[lastKey] === "string") {
        meta[lastKey] = `${meta[lastKey]} ${line.trim()}`.trim();
      }
    }
    return { meta, body: (match[2] ?? "").trim(), recovered: true };
  }
}
function flatValue(raw) {
  if (/^\[.*\]$/.test(raw)) return raw.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  return raw.replace(/^(['"])(.*)\1$/, "$2");
}

// src/brain/store.ts
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, join } from "path";
import { randomUUID } from "crypto";
function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "note";
}
function legacyStem(meta) {
  if (meta.tier !== "transitive" || !meta.legacy_id) return void 0;
  const prefix = TRANSITIVE_PREFIX[meta.kind ?? "lesson"];
  const match = /^([A-Z])-(\d+)$/.exec(meta.legacy_id);
  if (!prefix || !match || `${match[1]}-` !== prefix) return void 0;
  return `${prefix}${match[2]}-${slugify(meta.title)}`;
}
function createId(meta, date = /* @__PURE__ */ new Date()) {
  if (meta.tier === "episodic") return `${date.toISOString().slice(0, 10)}-${slugify(meta.title)}-${randomUUID().slice(0, 8)}`;
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
    path = join(brain, TIER_DIRS.canonical, slugify(String(meta.kind ?? "domain")), `${slugify(meta.title)}.md`);
  } else if (meta.tier === "episodic") {
    const stamp = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 16).replace(":", "")}`;
    const suffix = /-([a-f0-9]{8})$/.exec(meta.id)?.[1];
    path = join(brain, TIER_DIRS.episodic, `${stamp}_${slugify(meta.title)}${suffix ? `-${suffix}` : ""}.md`);
  } else {
    const prefix = TRANSITIVE_PREFIX[meta.kind];
    if (!prefix) throw new Error(`Invalid transitive kind: ${String(meta.kind)}`);
    path = join(brain, TIER_DIRS.transitive, `${legacyStem(meta) === meta.id ? meta.id : `${prefix}${slugify(meta.title)}`}.md`);
  }
  const base = resolve(brain);
  const resolved = resolve(path);
  const rel = relative(base, resolved);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Brain note path escapes the brain root");
  return resolved;
}
var atomicFs = {
  mkdir,
  writeFile,
  rename,
  copyFile,
  rm,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms))
};
var LOCKED = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES"]);
var RENAME_BACKOFF_MS = [10, 20, 40, 80, 160, 320, 400, 400, 400];
var isLocked = (error) => LOCKED.has(String(error?.code));
async function atomicWrite(path, content) {
  noteCache.delete(resolve(path));
  await atomicFs.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
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
var noteCache = /* @__PURE__ */ new Map();
var noteParses = 0;
var fresh = (note) => note && { meta: structuredClone(note.meta), body: note.body, path: note.path };
async function readNote(path) {
  const key = resolve(path);
  try {
    const info = await stat(path);
    const cached = noteCache.get(key);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size && cached.ino === info.ino) return fresh(cached.note);
    noteParses++;
    const parsed = parseMarkdown(await readFile(path, "utf8"));
    const note = parsed.meta.id && parsed.meta.tier && parsed.meta.title ? { meta: parsed.meta, body: parsed.body, path } : void 0;
    noteCache.set(key, { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino, note });
    return fresh(note);
  } catch {
    noteCache.delete(key);
    return void 0;
  }
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
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.endsWith(".base.md")) paths.push(path);
  }
  return paths;
}
async function listLocation(location) {
  const notes = [];
  for (const dir of [TIER_DIRS.canonical, TIER_DIRS.episodic, TIER_DIRS.transitive]) {
    for (const path of await markdownFiles(join(brainPath(location), dir))) {
      const note = await readNote(path);
      if (note) notes.push(note);
    }
  }
  return notes;
}
async function overlayNotes(locations) {
  const byId = /* @__PURE__ */ new Map();
  for (const location of [...locations].reverse()) for (const note of await listLocation(location)) byId.set(note.meta.id, note);
  return [...byId.values()];
}
function encodeNote(note) {
  return serializeMarkdown(note.meta, note.body);
}

export {
  TIER_DIRS,
  INDEX_DIR,
  TRANSITIVE_PREFIX,
  parseMarkdown,
  serializeMarkdown,
  parseMarkdownLenient,
  slugify,
  createId,
  notePath,
  atomicWrite,
  readNote,
  overlayNotes,
  encodeNote
};
//# sourceMappingURL=chunk-GURUD2GB.js.map