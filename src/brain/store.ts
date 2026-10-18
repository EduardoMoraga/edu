import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INDEX_DIR, TRANSITIVE_PREFIX, TIER_DIRS, type BrainLocation, type Note, type NoteMeta, type TransitiveKind } from '../core/contracts.js';
import { parseMarkdown, serializeMarkdown } from './frontmatter.js';
import { brainPath } from './location.js';

export function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';
}

/**
 * `D-010-slug` when a transitive note carries a legacy correlative with the same letter as its Edu prefix
 * (Albert `D-010` → Edu decision): the correlative stays visible in the id and the filename, ids stay unique
 * where titles repeat, and the id is deterministic so re-imports find the same note.
 */
export function legacyStem(meta: Pick<NoteMeta, 'tier' | 'kind' | 'title' | 'legacy_id'>): string | undefined {
  if (meta.tier !== 'transitive' || !meta.legacy_id) return undefined;
  const prefix = TRANSITIVE_PREFIX[(meta.kind as TransitiveKind) ?? 'lesson'];
  const match = /^([A-Z])-(\d+)$/.exec(meta.legacy_id);
  if (!prefix || !match || `${match[1]}-` !== prefix) return undefined;
  return `${prefix}${match[2]}-${slugify(meta.title)}`;
}

export function createId(meta: Pick<NoteMeta, 'tier' | 'kind' | 'title'> & Partial<Pick<NoteMeta, 'legacy_id'>>, date = new Date()): string {
  if (meta.tier === 'episodic') return `${date.toISOString().slice(0, 10)}-${slugify(meta.title)}-${randomUUID().slice(0, 8)}`;
  const legacy = legacyStem(meta);
  if (legacy) return legacy;
  const prefix = meta.tier === 'canonical' ? 'K-' : TRANSITIVE_PREFIX[(meta.kind as TransitiveKind) ?? 'lesson'];
  return `${prefix}${slugify(meta.title)}`;
}

/** `brain` is the brain folder itself (see `brainPath()`); the note must stay inside it. */
export function notePath(brain: string, meta: NoteMeta, now = new Date()): string {
  let path: string;
  if (meta.tier === 'canonical') {
    const canonicalKinds = ['identity', 'standard', 'lexicon', 'domain', 'person', 'preference'];
    if (meta.kind && !canonicalKinds.includes(meta.kind)) throw new Error(`Invalid canonical kind: ${meta.kind}`);
    path = join(brain, TIER_DIRS.canonical, slugify(String(meta.kind ?? 'domain')), `${slugify(meta.title)}.md`);
  }
  else if (meta.tier === 'episodic') {
    const stamp = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 16).replace(':', '')}`;
    const suffix = /-([a-f0-9]{8})$/.exec(meta.id)?.[1];
    path = join(brain, TIER_DIRS.episodic, `${stamp}_${slugify(meta.title)}${suffix ? `-${suffix}` : ''}.md`);
  } else {
    const prefix = TRANSITIVE_PREFIX[meta.kind as TransitiveKind];
    if (!prefix) throw new Error(`Invalid transitive kind: ${String(meta.kind)}`);
    path = join(brain, TIER_DIRS.transitive, `${legacyStem(meta) === meta.id ? meta.id : `${prefix}${slugify(meta.title)}`}.md`);
  }
  const base = resolve(brain);
  const resolved = resolve(path);
  const rel = relative(base, resolved);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Brain note path escapes the brain root');
  return resolved;
}

/**
 * File operations behind `atomicWrite`, as an object so tests can simulate a locked target with vi.spyOn.
 * Not part of the public API.
 */
export const atomicFs = {
  mkdir, writeFile, rename, copyFile, link, rm,
  sleep: (ms: number) => new Promise<void>(done => setTimeout(done, ms)),
};

/** Windows reports a target held open by another process (Obsidian, antivirus, an indexer) with these codes. */
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Backoff between rename attempts, ~1.8 s in total (graceful-fs style). */
export const RENAME_BACKOFF_MS = [10, 20, 40, 80, 160, 320, 400, 400, 400];

const isLocked = (error: unknown) => LOCKED.has(String((error as NodeJS.ErrnoException | undefined)?.code));

/**
 * Writes through a temp file renamed over the target. When the rename keeps failing because another process
 * holds the target (common on Windows), it retries with backoff and finally copies the temp file over the
 * target in place. The temp file never survives, and a write that cannot land at all throws.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  noteCache.delete(resolve(path));
  await atomicFs.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await atomicFs.writeFile(temp, content, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try { await atomicFs.rename(temp, path); return; }
      catch (error) {
        if (!isLocked(error)) throw error;
        const delay = RENAME_BACKOFF_MS[attempt];
        if (delay === undefined) {
          // Still locked: a direct copy only needs write access to the target, not delete/replace rights.
          try { await atomicFs.copyFile(temp, path); return; } catch { throw error; }
        }
        await atomicFs.sleep(delay);
      }
    }
  } finally {
    await atomicFs.rm(temp, { force: true }).catch(() => { /* best effort: nothing else to clean */ });
  }
}

/** Publish a complete file atomically, without replacing even an unreadable/malformed destination.
 * The temp is a sibling so the hard link stays on the same volume. Unsupported filesystems fail closed.
 */
export async function exclusiveWrite(path: string, content: string): Promise<void> {
  await atomicFs.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await atomicFs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
    for (let attempt = 0; ; attempt++) {
      try { await atomicFs.link(temp, path); break; }
      catch (error) {
        const delay = RENAME_BACKOFF_MS[attempt];
        if (!isLocked(error) || delay === undefined) throw error;
        await atomicFs.sleep(delay);
      }
    }
    noteCache.delete(resolve(path));
  } finally {
    await atomicFs.rm(temp, { force: true }).catch(() => { /* Publication is already complete or failed closed. */ });
  }
}

/** Usage updates must not serialize the normalized read model over the original frontmatter. */
export async function persistNoteUsage(note: Note): Promise<void> {
  const raw = parseMarkdown(await readFile(note.path, 'utf8'));
  await atomicWrite(note.path, serializeMarkdown({ ...raw.meta, usage: note.meta.usage, updated: note.meta.updated }, raw.body));
}

/**
 * Per-process cache of parsed notes keyed by absolute path and validated by mtime, size and inode, so a
 * process that lists the brain several times (brief + usage tracking, maintenance) reads and parses each
 * file once. `atomicWrite` evicts the path it writes; an external edit changes the stat and is re-read.
 */
interface CachedNote { mtimeMs: number; size: number; ino: number; note: Note | undefined }
const noteCache = new Map<string, CachedNote>();
let noteParses = 0;

/** Test hooks: clear the cache and count how many note files were actually read and parsed. */
export function resetNoteCache(): void { noteCache.clear(); noteParses = 0; }
export function noteCacheStats(): { entries: number; parses: number } { return { entries: noteCache.size, parses: noteParses }; }

// Callers spread and patch notes freely, so every hit hands out its own meta (including tags/links/usage).
const fresh = (note: Note | undefined): Note | undefined => note && { meta: structuredClone(note.meta), body: note.body, path: note.path };

export async function readNote(path: string): Promise<Note | undefined> {
  const key = resolve(path);
  try {
    const info = await stat(path);
    const cached = noteCache.get(key);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size && cached.ino === info.ino) return fresh(cached.note);
    noteParses++;
    const parsed = parseMarkdown(await readFile(path, 'utf8'));
    const raw = parsed.meta;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.title !== 'string' || !raw.title.trim() || typeof raw.tier !== 'string' || !['canonical', 'episodic', 'transitive'].includes(raw.tier)) throw new Error('Invalid note identity');
    const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : [];
    const date = (value: unknown, fallback: string) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback;
    const meta = { ...raw, tags: strings(raw.tags), links: strings(raw.links), created: date(raw.created, info.mtime.toISOString()) } as unknown as NoteMeta;
    for (const field of ['source', 'owner', 'stakeholder', 'due', 'supersedes', 'legacy_id', 'origin', 'superseded_by', 'kind', 'status', 'band'] as const) {
      if (typeof raw[field] !== 'string' || !raw[field].trim()) delete meta[field];
    }
    if (meta.band && !['verified', 'inferred', 'hypothesis'].includes(meta.band)) delete meta.band;
    if (raw.aliases !== undefined) meta.aliases = strings(raw.aliases);
    if (raw.updated !== undefined) meta.updated = date(raw.updated, meta.created);
    if (raw.usage !== undefined) {
      const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage as Record<string, unknown> : {};
      const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
      meta.usage = { ...usage, uses: count(usage.uses), wins: count(usage.wins), losses: count(usage.losses), ...(typeof usage.lastUsed === 'string' && Number.isFinite(Date.parse(usage.lastUsed)) ? { lastUsed: usage.lastUsed } : {}) };
      if (!Number.isFinite(Date.parse(meta.usage.lastUsed ?? ''))) delete meta.usage.lastUsed;
    }
    const note = { meta, body: parsed.body, path };
    noteCache.set(key, { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino, note });
    return fresh(note);
  } catch (error) {
    noteCache.delete(key);
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') console.warn(`Edu: cannot read note ${key} (${code ?? 'INVALID_NOTE'}); file left unchanged.`);
    return undefined;
  }
}

async function markdownFiles(dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.base.md')) paths.push(path);
  }
  return paths;
}

export async function listLocation(location: BrainLocation): Promise<Note[]> {
  const notes: Note[] = [];
  for (const dir of [TIER_DIRS.canonical, TIER_DIRS.episodic, TIER_DIRS.transitive]) {
    const paths = await markdownFiles(join(brainPath(location), dir));
    // Bound concurrent filesystem reads while preserving discovery/overlay order.
    // Serial stat/read pairs dominated cold maintenance on Windows large brains.
    for (let offset = 0; offset < paths.length; offset += 16) {
      const batch = await Promise.all(paths.slice(offset, offset + 16).map(path => readNote(path)));
      for (const note of batch) if (note) notes.push(note);
    }
  }
  return notes;
}

export async function overlayNotes(locations: BrainLocation[]): Promise<Note[]> {
  const byId = new Map<string, Note>();
  for (const location of [...locations].reverse()) for (const note of await listLocation(location)) byId.set(note.meta.id, note);
  return [...byId.values()];
}

export function encodeNote(note: Note): string { return serializeMarkdown(note.meta as unknown as Record<string, unknown>, note.body); }
export { INDEX_DIR };
