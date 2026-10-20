import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteMeta } from '../core/contracts.js';
import { brainPath } from './location.js';
import * as store from './store.js';
import { openBrain } from './brain.js';

vi.mock('./store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./store.js')>();
  return { ...actual, overlayNotes: vi.fn(actual.overlayNotes) };
});

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-maintain-')); dirs.push(path); return path; }
beforeEach(() => { vi.mocked(store.overlayNotes).mockClear(); });
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

/** Writes notes straight to disk, the way an importer leaves them, without going through `brain.write`. */
async function seed(root: string, count: number, meta: (i: number) => Partial<NoteMeta> & Pick<NoteMeta, 'title' | 'kind'>) {
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    const partial = meta(i);
    const full: NoteMeta = { id: store.createId({ tier: 'transitive', kind: partial.kind, title: partial.title }), tier: 'transitive', tags: [], links: [], created: now, updated: now, source: 'import:albert', ...partial };
    const note: Note = { meta: full, body: `Body ${i}`, path: store.notePath(brainPath({ scope: 'project', root }), full) };
    await store.atomicWrite(note.path, store.encodeNote(note));
  }
}

const proposals = async (root: string) => (await openBrain([{ scope: 'project', root }]).list({ tier: 'canonical' })).filter(note => note.meta.source === 'edu:maintain');

describe('brain.maintain canonical proposals', () => {
  it('does not propose lessons that arrive already proven (imported)', async () => {
    const root = await temp();
    await seed(root, 25, i => ({ title: `Imported lesson ${i}`, kind: 'lesson', status: 'proven' }));
    const report = await openBrain([{ scope: 'project', root }]).maintain();
    expect(report.promoted).toEqual([]);
    expect(await proposals(root)).toHaveLength(0);
  });

  it('proposes exactly once for a candidate lesson promoted by this run, and not on the next run', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const lesson = await brain.write({ title: 'Pin dependency versions', body: 'Lockfiles matter.', tier: 'transitive', kind: 'lesson' });
    await brain.update(lesson.meta.id, { usage: { uses: 3, wins: 3, losses: 0, verifiedWins: 3, lastUsed: new Date().toISOString() } });
    const first = await brain.maintain();
    expect(first.promoted).toEqual([lesson.meta.id]);
    expect(await proposals(root)).toHaveLength(1);
    const second = await brain.maintain();
    expect(second.promoted).toEqual([]);
    expect(await proposals(root)).toHaveLength(1);
  });

  it('loads notes a constant number of times regardless of brain size', async () => {
    const small = await temp(), large = await temp();
    await seed(small, 10, i => ({ title: `Lesson ${i}`, kind: 'lesson', status: 'proven' }));
    await seed(large, 200, i => ({ title: `Lesson ${i}`, kind: 'lesson', status: 'proven' }));
    await openBrain([{ scope: 'project', root: small }]).maintain();
    const smallCalls = vi.mocked(store.overlayNotes).mock.calls.length;
    vi.mocked(store.overlayNotes).mockClear();
    await openBrain([{ scope: 'project', root: large }]).maintain();
    expect(vi.mocked(store.overlayNotes).mock.calls.length).toBe(smallCalls);
    expect(smallCalls).toBeLessThanOrEqual(2);
  });

  it('maintains a brain of about 1000 notes in under 2 seconds', async () => {
    const root = await temp();
    await seed(root, 750, i => ({ title: `Lesson ${i}`, kind: 'lesson', status: 'proven' }));
    await seed(root, 250, i => ({ title: `Decision ${i}`, kind: 'decision', status: 'active' }));
    const started = performance.now();
    const report = await openBrain([{ scope: 'project', root }]).maintain();
    expect(performance.now() - started).toBeLessThan(2000);
    expect(report.indexRebuilt).toBe(true);
    expect(await proposals(root)).toHaveLength(0);
  }, 30_000);
});
