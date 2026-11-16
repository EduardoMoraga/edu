/**
 * Persistent, machine-local cache of parsed note files: `<root>/.edu-local/notes-cache.json`.
 *
 * Every hook, CLI call and MCP server is a new process, so without it each one re-reads and re-parses the YAML of
 * every note. An entry is used only while its file's mtime, size and inode are unchanged (the same check as the
 * in-process cache); anything else is read and parsed again. The file is a pure accelerator: when it is missing,
 * corrupt, from another format version, or sits behind a symbolic link, it is ignored, and a failed save never
 * fails a read. It lives in the git-ignored machine-local folder, never in the synced brain.
 */
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NoteMeta } from '../core/contracts.js';
import { LOCAL_DIR, ensureLocalIgnored, safeLocalTarget } from './local-dir.js';

export const NOTE_CACHE_FILE = 'notes-cache.json';
/** Bump when reading or validating a note changes what an entry holds: older caches are then ignored. */
const FORMAT = 1;

/** One file as last read: its stat identity and either the validated note or why it was quarantined. */
export interface CachedFile {
  mtimeMs: number;
  size: number;
  ino: number;
  note?: { meta: NoteMeta; body: string };
  problem?: string;
}

export const noteCachePath = (root: string) => join(root, LOCAL_DIR, NOTE_CACHE_FILE);

const isEntry = (value: unknown): value is CachedFile => {
  const entry = value as CachedFile | null;
  if (!entry || typeof entry !== 'object' || typeof entry.mtimeMs !== 'number' || typeof entry.size !== 'number' || typeof entry.ino !== 'number') return false;
  if (typeof entry.problem === 'string') return entry.note === undefined;
  const note = entry.note;
  return Boolean(note && typeof note.body === 'string' && note.meta && typeof note.meta === 'object'
    && typeof note.meta.id === 'string' && typeof note.meta.tier === 'string' && typeof note.meta.title === 'string'
    && Array.isArray(note.meta.tags) && Array.isArray(note.meta.links) && typeof note.meta.created === 'string');
};

/** Entries by absolute file path; empty when there is no usable cache. */
export async function loadNoteCache(root: string): Promise<Map<string, CachedFile>> {
  const entries = new Map<string, CachedFile>();
  const path = noteCachePath(root);
  try {
    if (!await safeLocalTarget(root, path, true)) return entries;
    const raw = JSON.parse(await readFile(path, 'utf8')) as { format?: unknown; entries?: unknown };
    if (raw?.format !== FORMAT || !raw.entries || typeof raw.entries !== 'object') return entries;
    for (const [file, entry] of Object.entries(raw.entries as Record<string, unknown>)) if (isEntry(entry)) entries.set(file, entry);
  } catch { /* missing or unreadable: no cache */ }
  return entries;
}

/** Replaces the cache of a root with `entries`. Best effort: returns false instead of throwing. */
export async function saveNoteCache(root: string, entries: ReadonlyMap<string, CachedFile>): Promise<boolean> {
  const path = noteCachePath(root);
  try {
    await access(root); // never create a brain root just to cache it
    if (!await safeLocalTarget(root, path, true)) return false;
    await ensureLocalIgnored(root);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ format: FORMAT, entries: Object.fromEntries(entries) }), 'utf8');
      await rename(temp, path);
    } finally { await rm(temp, { force: true }).catch(() => { /* nothing left to clean */ }); }
    return true;
  } catch { return false; }
}
