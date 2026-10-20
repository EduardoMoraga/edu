import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, readFile, writeFile, link } from 'node:fs/promises';
import { join } from 'node:path';
import { createId, type Brain, type NewNote } from '../brain/index.js';

export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Atomic installation avoids a crash leaving a half-written owner record. */
async function claim(path: string, owner: string, depth = 0): Promise<(() => Promise<void>) | undefined> {
  if (depth > 8) return undefined; // Fail closed on pathological repeated recovery crashes.
  const temporary = `${path}.${randomUUID()}.owner`;
  await writeFile(temporary, owner, { flag: 'wx' });
  const release = async () => {
    // Best effort cleanup must never replace the action's result/error, nor remove a successor.
    try { if (await readFile(path, 'utf8') === owner) await rm(path, { force: true }); } catch { /* Retry can recover a dead owner. */ }
  };
  try {
    try { await link(temporary, path); return release; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    let stale: string;
    try { stale = await readFile(path, 'utf8'); } catch { return undefined; }
    if (!deadOwner(stale)) return undefined;
    // Serialize stale-owner removal. A competing normal acquisition may win after unlink;
    // the exclusive link below then fails rather than replacing its live owner.
    const releaseRecovery = await claim(`${path}.recovery`, owner, depth + 1);
    if (!releaseRecovery) return undefined;
    try {
      if (await readFile(path, 'utf8').catch(() => '') !== stale || !deadOwner(stale)) return undefined;
      await rm(path);
      try { await link(temporary, path); return release; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined; throw error; }
    } finally { await releaseRecovery(); }
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}
function deadOwner(raw: string): boolean {
  try {
    const owner = JSON.parse(raw);
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || (owner.host && owner.host !== hostname())) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  } catch { return false; }
}

/** Shared across local consolidation, explicit reflection and human proposal operations. */
export async function locked<T>(root: string, action: () => Promise<T>): Promise<T | undefined> {
  await mkdir(root, { recursive: true });
  const path = join(await realpath(root), '.reflection.lock');
  const release = await claim(path, JSON.stringify({ pid: process.pid, host: hostname(), token: randomUUID(), startedAt: new Date().toISOString() }));
  if (!release) return undefined;
  try { return await action(); }
  finally { await release(); }
}

export interface WriteResult { id: string; created: boolean; rejected: boolean }
const canonicalBody = (body: string) => body.replace(/\r\n?/g, '\n').trim();

/** Brain ids derive from titles. Keep an explicit content/evidence suffix, independent of tags. */
export async function writeOnce(brain: Brain, input: NewNote, identity?: unknown): Promise<WriteResult> {
  const body = canonicalBody(input.body);
  const links = [...new Set(input.links ?? [])].sort();
  const key = digest(identity ?? { kind: input.kind, tier: input.tier, title: input.title, body, links });
  const value = { ...input, body, links, title: `${input.title} [${key.slice(0, 24)}]` };
  const id = createId(value);
  const existing = await brain.read(id);
  if (existing) {
    if (canonicalBody(existing.body) !== body || existing.meta.source !== input.source || JSON.stringify([...existing.meta.links].sort()) !== JSON.stringify(links)) {
      throw new Error(`Reflection identity collision: ${id}`);
    }
    return { id, created: false, rejected: false };
  }
  // Rejected canonical proposals remain rejected, even after an interrupted retry.
  const rejection = (await brain.list({ tier: 'episodic' })).find(note => note.meta.source === 'edu:reject' && note.meta.links.includes(id));
  if (rejection) return { id, created: false, rejected: true };
  return { id: (await (input.tier === 'canonical' ? brain.proposeCanonical(value) : brain.write(value))).meta.id, created: true, rejected: false };
}
