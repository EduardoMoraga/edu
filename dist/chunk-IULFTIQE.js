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
  const normalized = source.replace(/\r\n/g, "\n");
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
    const normalized = source.replace(/\r\n/g, "\n");
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
import { mkdir, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, join } from "path";
import { randomUUID } from "crypto";
function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "note";
}
function createId(meta, date = /* @__PURE__ */ new Date()) {
  if (meta.tier === "episodic") return `${date.toISOString().slice(0, 10)}-${slugify(meta.title)}-${randomUUID().slice(0, 8)}`;
  const prefix = meta.tier === "canonical" ? "K-" : TRANSITIVE_PREFIX[meta.kind ?? "lesson"];
  return `${prefix}${slugify(meta.title)}`;
}
function notePath(root, meta, now = /* @__PURE__ */ new Date()) {
  let path;
  if (meta.tier === "canonical") {
    const canonicalKinds = ["identity", "standard", "lexicon", "domain", "person", "preference"];
    if (meta.kind && !canonicalKinds.includes(meta.kind)) throw new Error(`Invalid canonical kind: ${meta.kind}`);
    path = join(root, "brain", TIER_DIRS.canonical, slugify(String(meta.kind ?? "domain")), `${slugify(meta.title)}.md`);
  } else if (meta.tier === "episodic") {
    const stamp = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 16).replace(":", "")}`;
    const suffix = /-([a-f0-9]{8})$/.exec(meta.id)?.[1];
    path = join(root, "brain", TIER_DIRS.episodic, `${stamp}_${slugify(meta.title)}${suffix ? `-${suffix}` : ""}.md`);
  } else {
    const prefix = TRANSITIVE_PREFIX[meta.kind];
    if (!prefix) throw new Error(`Invalid transitive kind: ${String(meta.kind)}`);
    path = join(root, "brain", TIER_DIRS.transitive, `${prefix}${slugify(meta.title)}.md`);
  }
  const base = resolve(root);
  const resolved = resolve(path);
  const rel = relative(base, resolved);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Brain note path escapes the brain root");
  return resolved;
}
async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
async function readNote(path) {
  try {
    const parsed = parseMarkdown(await readFile(path, "utf8"));
    if (!parsed.meta.id || !parsed.meta.tier || !parsed.meta.title) return void 0;
    return { meta: parsed.meta, body: parsed.body, path };
  } catch {
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
    for (const path of await markdownFiles(join(location.root, "brain", dir))) {
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
  overlayNotes,
  encodeNote
};
//# sourceMappingURL=chunk-IULFTIQE.js.map