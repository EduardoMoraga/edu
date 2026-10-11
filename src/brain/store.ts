import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INDEX_DIR, TRANSITIVE_PREFIX, TIER_DIRS, type BrainLocation, type Note, type NoteMeta, type TransitiveKind } from '../core/contracts.js';
import { parseMarkdown, serializeMarkdown } from './frontmatter.js';
import { brainPath } from './location.js';

export function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';
}

export function createId(meta: Pick<NoteMeta, 'tier' | 'kind' | 'title'>, date = new Date()): string {
  if (meta.tier === 'episodic') return `${date.toISOString().slice(0, 10)}-${slugify(meta.title)}-${randomUUID().slice(0, 8)}`;
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
    path = join(brain, TIER_DIRS.transitive, `${prefix}${slugify(meta.title)}.md`);
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
  mkdir, writeFile, rename, copyFile, rm,
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
    const parsed = parseMarkdown<NoteMeta>(await readFile(path, 'utf8'));
    const note = parsed.meta.id && parsed.meta.tier && parsed.meta.title ? { meta: parsed.meta, body: parsed.body, path } : undefined;
    noteCache.set(key, { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino, note });
    return fresh(note);
  } catch { noteCache.delete(key); return undefined; }
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
    for (const path of await markdownFiles(join(brainPath(location), dir))) {
      const note = await readNote(path); if (note) notes.push(note);
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
