import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { INDEX_DIR, TRANSITIVE_PREFIX, TIER_DIRS, type BrainLocation, type Note, type NoteMeta, type TransitiveKind } from '../core/contracts.js';
import { serializeMarkdown } from './frontmatter.js';
import { brainPath } from './location.js';
import { assertInsideBrain } from './safe-path.js';
import { readNoteSource } from './note-schema.js';
import { loadNoteCache, saveNoteCache, type CachedFile } from './note-cache.js';

/** Longest slug (file names and ids stay far below every platform's name limit). */
export const MAX_SLUG = 80;
/** Latin letters that Unicode does not decompose into a base letter plus an accent. */
const LATIN_LETTERS: Record<string, string> = { ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h', ŧ: 't', ŋ: 'n' };
/** Device names Windows reserves in every folder, with any extension. */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * ASCII slug for ids and file names: accents dropped, lowercase, `-` between words, at most MAX_SLUG characters.
 * When the title has letters ASCII cannot spell (CJK, Cyrillic, …) or is cut to fit, a short hash of the whole
 * title is appended (or is the slug), so distinct titles keep distinct ids instead of all becoming `note`.
 */
export function slugify(value: string): string {
  const folded = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[ßæøœłđðþıħŧŋ]/g, letter => LATIN_LETTERS[letter]!);
  const slug = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const unspelled = /[\p{L}\p{N}]/u.test(folded.replace(/[\x00-\x7f]+/g, ''));
  if (!unspelled && slug.length <= MAX_SLUG) return !slug ? 'note' : WINDOWS_RESERVED.test(slug) ? `${slug}-note` : slug;
  const hash = createHash('sha256').update(value.normalize('NFC')).digest('hex').slice(0, 8);
  const head = slug.slice(0, MAX_SLUG - hash.length - 1).replace(/-+$/, '');
  return head ? `${head}-${hash}` : hash;
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
  mkdir, writeFile, rename, copyFile, rm, link,
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
 *
 * With `root`, the target must stay inside that brain root with no symbolic link on the way or as the file
 * itself (see `assertInsideBrain`); otherwise an `UnsafeBrainPathError` is thrown before anything is written.
 * Without it the rename still never follows a symlinked target: it replaces the link itself.
 */
export async function atomicWrite(path: string, content: string, options: { root?: string } = {}): Promise<void> {
  if (options.root !== undefined) await assertInsideBrain(options.root, path);
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

/** `link` failures that mean "no hard links on this file system" (FAT, exFAT, some network shares), not "exists". */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EACCES']);

/**
 * Creates `path` with `content` only if nothing exists there yet: throws an `EEXIST` error otherwise, so a new note
 * can never replace another file (a note with a different id, a quarantined file, a file a user just created).
 * The content is written to a temp file first and hard-linked into place (atomic and exclusive on POSIX and NTFS);
 * where hard links are unsupported, an exclusive create (`wx`) is used instead. Same containment as `atomicWrite`.
 */
export async function exclusiveWrite(path: string, content: string, options: { root?: string } = {}): Promise<void> {
  if (options.root !== undefined) await assertInsideBrain(options.root, path);
  noteCache.delete(resolve(path));
  await atomicFs.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await atomicFs.writeFile(temp, content, 'utf8');
    try { await atomicFs.link(temp, path); }
    catch (error) {
      if (!NO_HARD_LINKS.has(String((error as NodeJS.ErrnoException).code))) throw error;
      await atomicFs.writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
    }
  } finally {
    await atomicFs.rm(temp, { force: true }).catch(() => { /* best effort: nothing else to clean */ });
  }
}

/** A write refused because its path holds something else: another note, or a file that is not a valid note. */
export class PathTakenError extends Error {
  readonly code = 'EEXIST' as const;
  constructor(message: string) { super(message); this.name = 'PathTakenError'; }
}

/** True when a write failed because the target path is taken (`exclusiveWrite`'s EEXIST or a `PathTakenError`). */
export const isAlreadyExists = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';

/**
 * Per-process cache of parsed notes keyed by absolute path and validated by mtime, size and inode, so a
 * process that lists the brain several times (brief + usage tracking, maintenance) reads and parses each
 * file once. `atomicWrite` evicts the path it writes; an external edit changes the stat and is re-read.
 * A listing also consults the persistent cache of its root (`note-cache.ts`), so a new process skips files
 * an earlier process already parsed, and saves it back when anything changed.
 */
const noteCache = new Map<string, CachedFile>();
/** Persistent caches loaded by this process, by brain root. */
const diskCaches = new Map<string, Map<string, CachedFile>>();
/**
 * Roots whose persistent cache this process already saved. One save per process and root: a long-lived process
 * (an MCP server, an import) that keeps changing notes does not rewrite the whole cache after every write; the next
 * new process re-parses only the files changed since and saves once itself.
 */
const savedCaches = new Set<string>();
let noteParses = 0;
let locationListings = 0;

/**
 * Test hooks: forget everything this process cached (as a new process would); count note files read and parsed,
 * and completed location listings.
 */
export function resetNoteCache(): void { noteCache.clear(); diskCaches.clear(); savedCaches.clear(); noteParses = 0; locationListings = 0; }
export function noteCacheStats(): { entries: number; parses: number; listings: number } { return { entries: noteCache.size, parses: noteParses, listings: locationListings }; }

// Callers spread and patch notes freely, so every hit hands out its own meta (including tags/links/usage).
const handOut = (entry: CachedFile, path: string): NoteInspection => entry.note
  ? { note: { meta: structuredClone(entry.note.meta), body: entry.note.body, path } }
  : { problem: entry.problem ?? 'unreadable' };
type FileIdentity = Pick<Stats, 'mtimeMs' | 'size' | 'ino'>;
const sameFile = (entry: CachedFile | undefined, info: FileIdentity) => entry !== undefined && entry.mtimeMs === info.mtimeMs && entry.size === info.size && entry.ino === info.ino;

/**
 * Before 5.0 a reverted decision stored its successor in `supersedes`, so it read as if it replaced the decision
 * that actually replaced it. Read it as `superseded_by`, the field every other replaced note uses; the file is
 * rewritten in the new form only when something else changes it.
 */
export function normalizeLegacyMeta(meta: NoteMeta): NoteMeta {
  if (meta.kind !== 'decision' || meta.status !== 'reverted' || !meta.supersedes || meta.superseded_by) return meta;
  const { supersedes, ...rest } = meta;
  return { ...rest, superseded_by: supersedes };
}

/** A file read as a note, or why it could not be (it is quarantined: reported, never loaded, never overwritten). */
export type NoteInspection = { note: Note } | { problem: string };
/** A quarantined file of a brain location. */
export interface NoteProblem { path: string; problem: string; scope: BrainLocation['scope'] }

/**
 * Reads and validates one note file. Undefined when there is no readable file at `path` (missing, a folder,
 * no permission); `{ problem }` when the file exists but is not a valid note (see `note-schema.ts`).
 */
export async function inspectNote(path: string, disk?: ReadonlyMap<string, CachedFile>): Promise<NoteInspection | undefined> {
  const key = resolve(path);
  try {
    const info = await stat(path);
    const cached = noteCache.get(key);
    if (sameFile(cached, info)) return handOut(cached!, path);
    const stored = disk?.get(key);
    if (sameFile(stored, info)) { noteCache.set(key, stored!); return handOut(stored!, path); }
    const source = await readFile(path, 'utf8');
    noteParses++;
    const read = readNoteSource(source, new Date(info.mtimeMs).toISOString());
    const entry: CachedFile = { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino,
      ...('problem' in read ? { problem: read.problem } : { note: { meta: normalizeLegacyMeta(read.meta), body: read.body } }) };
    noteCache.set(key, entry);
    return handOut(entry, path);
  } catch { noteCache.delete(key); return undefined; }
}

/** The note at `path`, or undefined when there is none or the file is quarantined. */
export async function readNote(path: string): Promise<Note | undefined> {
  const read = await inspectNote(path);
  return read && 'note' in read ? read.note : undefined;
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

/** Inspects files with bounded concurrency, keeping their order. */
async function inspectAll(paths: string[], disk: ReadonlyMap<string, CachedFile>): Promise<(NoteInspection | undefined)[]> {
  const results = new Array<NoteInspection | undefined>(paths.length);
  let next = 0;
  const worker = async () => { for (let index = next++; index < paths.length; index = next++) results[index] = await inspectNote(paths[index]!, disk); };
  await Promise.all(Array.from({ length: Math.min(32, paths.length) }, worker));
  return results;
}

/** Every note of one location, plus the files quarantined there. */
export async function scanLocation(location: BrainLocation): Promise<{ notes: Note[]; problems: NoteProblem[] }> {
  const brain = brainPath(location);
  const paths = (await Promise.all([TIER_DIRS.canonical, TIER_DIRS.episodic, TIER_DIRS.transitive].map(dir => markdownFiles(join(brain, dir))))).flat();
  const root = resolve(location.root);
  let disk = diskCaches.get(root);
  if (!disk) { disk = await loadNoteCache(root); diskCaches.set(root, disk); }
  const read = await inspectAll(paths, disk);
  const notes: Note[] = [], problems: NoteProblem[] = [];
  const current = new Map<string, CachedFile>();
  read.forEach((result, index) => {
    const path = paths[index]!;
    if (!result) return;
    if ('note' in result) notes.push(result.note); else problems.push({ path, problem: result.problem, scope: location.scope });
    const entry = noteCache.get(resolve(path));
    if (entry) current.set(resolve(path), entry);
  });
  // Save the persistent cache when this listing differs from it (a file was added, changed or removed).
  if (!savedCaches.has(root) && (current.size || disk.size) && (current.size !== disk.size || [...current].some(([key, entry]) => !sameFile(disk.get(key), entry)))) {
    savedCaches.add(root);
    if (await saveNoteCache(root, current)) diskCaches.set(root, current);
  }
  locationListings++;
  return { notes, problems };
}

export async function listLocation(location: BrainLocation): Promise<Note[]> {
  return (await scanLocation(location)).notes;
}

/** The notes of several locations, the first location winning on a shared id, plus every quarantined file. */
export async function overlayScan(locations: BrainLocation[]): Promise<{ notes: Note[]; problems: NoteProblem[] }> {
  const byId = new Map<string, Note>();
  const problems: NoteProblem[] = [];
  for (const location of [...locations].reverse()) {
    const scan = await scanLocation(location);
    for (const note of scan.notes) byId.set(note.meta.id, note);
    problems.unshift(...scan.problems);
  }
  return { notes: [...byId.values()], problems };
}

/** Overlay of per-location note lists (highest priority first): the first list wins on a shared id. */
export function overlay(lists: readonly Note[][]): Note[] {
  const byId = new Map<string, Note>();
  for (const list of [...lists].reverse()) for (const note of list) byId.set(note.meta.id, note);
  return [...byId.values()];
}

export async function overlayNotes(locations: BrainLocation[]): Promise<Note[]> {
  return (await overlayScan(locations)).notes;
}

export function encodeNote(note: Note): string { return serializeMarkdown(note.meta as unknown as Record<string, unknown>, note.body); }

/** Frontmatter keys that are not content: learning signal (`usage`) and the write timestamp (`updated`). */
const VOLATILE_KEYS = new Set(['usage', 'updated']);
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
};

/**
 * Stable 12-hex content hash of a note: sha256 over its frontmatter (keys sorted, undefined dropped, without
 * `usage` and `updated`) and its normalized body. Recall, exposure and feedback never change it; any edit
 * of title, body, status, links, tags or provenance does. Used for hash-guarded writes (`expectedHash`).
 */
export function contentHash(note: Pick<Note, 'meta' | 'body'>): string {
  const meta = Object.fromEntries(Object.entries(note.meta).filter(([key]) => !VOLATILE_KEYS.has(key)));
  const body = note.body.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(JSON.stringify({ meta: canonicalJson(meta), body })).digest('hex').slice(0, 12);
}

/** Thrown by a hash-guarded update when the note changed since the caller read it. */
export class NoteConflictError extends Error {
  readonly code = 'note-conflict' as const;
  constructor(readonly id: string, readonly expectedHash: string, readonly currentHash: string) {
    super(`Note ${id} changed since it was read (expected ${expectedHash}, current ${currentHash}); re-read it and retry`);
    this.name = 'NoteConflictError';
  }
}
export { INDEX_DIR };
