import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INDEX_DIR, TRANSITIVE_PREFIX, TIER_DIRS, type BrainLocation, type Note, type NoteMeta, type TransitiveKind } from '../core/contracts.js';
import { parseMarkdown, serializeMarkdown } from './frontmatter.js';

export function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';
}

export function createId(meta: Pick<NoteMeta, 'tier' | 'kind' | 'title'>, date = new Date()): string {
  if (meta.tier === 'episodic') return `${date.toISOString().slice(0, 10)}-${slugify(meta.title)}-${randomUUID().slice(0, 8)}`;
  const prefix = meta.tier === 'canonical' ? 'K-' : TRANSITIVE_PREFIX[(meta.kind as TransitiveKind) ?? 'lesson'];
  return `${prefix}${slugify(meta.title)}`;
}

export function notePath(root: string, meta: NoteMeta, now = new Date()): string {
  if (meta.tier === 'canonical') return join(root, 'brain', TIER_DIRS.canonical, String(meta.kind ?? 'domain'), `${slugify(meta.title)}.md`);
  if (meta.tier === 'episodic') {
    const stamp = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 16).replace(':', '')}`;
    const suffix = /-([a-f0-9]{8})$/.exec(meta.id)?.[1];
    return join(root, 'brain', TIER_DIRS.episodic, `${stamp}_${slugify(meta.title)}${suffix ? `-${suffix}` : ''}.md`);
  }
  const prefix = TRANSITIVE_PREFIX[(meta.kind as TransitiveKind) ?? 'lesson'];
  return join(root, 'brain', TIER_DIRS.transitive, `${prefix}${slugify(meta.title)}.md`);
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, content, 'utf8'); await rename(temp, path); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function readNote(path: string): Promise<Note | undefined> {
  try {
    const parsed = parseMarkdown<NoteMeta>(await readFile(path, 'utf8'));
    if (!parsed.meta.id || !parsed.meta.tier || !parsed.meta.title) return undefined;
    return { meta: parsed.meta, body: parsed.body, path };
  } catch { return undefined; }
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
    for (const path of await markdownFiles(join(location.root, 'brain', dir))) {
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
