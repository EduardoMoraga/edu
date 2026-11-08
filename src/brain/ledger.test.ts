import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Note, NoteMeta } from '../core/contracts.js';
import { openBrain } from './brain.js';
import { parseMarkdown } from './frontmatter.js';
import { frontmatterUsage, ledgerPath, mergeExposure, readLedger, resetLedgerCache } from './ledger.js';
import { brainPath } from './location.js';
import { atomicWrite, encodeNote, notePath, resetNoteCache } from './store.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-ledger-')); dirs.push(path); return path; }
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function seed(root: string, meta: Partial<NoteMeta> & Pick<NoteMeta, 'id' | 'title'>): Promise<Note> {
  const full: NoteMeta = { tier: 'transitive', kind: 'lesson', status: 'candidate', tags: [], links: [], created: new Date().toISOString(), source: 'import', ...meta };
  const note: Note = { meta: full, body: `${meta.title} body`, path: notePath(brainPath({ scope: 'project', root }), full) };
  await atomicWrite(note.path, encodeNote(note));
  return note;
}

describe('exposure ledger', () => {
  it('recall and recordUse never rewrite note files; exposure lands in the local ledger', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Ledger lesson', body: 'exposure stays local' });
    const before = await readFile(note.path, 'utf8');
    const mtime = (await stat(note.path)).mtimeMs;
    await brain.recall('exposure local');
    await brain.recordUse([note.meta.id], new Date(Date.now() + 120_000));
    expect(await readFile(note.path, 'utf8')).toBe(before);
    expect((await stat(note.path)).mtimeMs).toBe(mtime);
    expect(parseMarkdown<NoteMeta>(before).meta.usage).toBeUndefined();
    const ledger = JSON.parse(await readFile(ledgerPath(root), 'utf8'));
    expect(ledger.notes[note.meta.id].uses).toBe(2);
    expect((await brain.read(note.meta.id))?.meta.usage).toMatchObject({ uses: 2, wins: 0, losses: 0 });
  });

  it('keeps feedback in frontmatter and exposure out of it', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Feedback stays', body: 'wins are content' });
    await brain.recordUse([note.meta.id]);
    await brain.feedback(note.meta.id, true);
    const disk = parseMarkdown<NoteMeta>(await readFile(note.path, 'utf8')).meta.usage;
    expect(disk).toEqual({ uses: 0, wins: 1, losses: 0 });
    expect((await brain.read(note.meta.id))?.meta.usage).toMatchObject({ uses: 1, wins: 1 });
  });

  it('reads legacy frontmatter exposure as the initial ledger value without rewriting the note', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const legacy = await seed(root, { id: 'L-legacy', title: 'legacy', usage: { uses: 7, wins: 2, losses: 0, lastUsed: '2026-01-01T00:00:00.000Z' } });
    const before = await readFile(legacy.path, 'utf8');
    expect((await brain.read('L-legacy'))?.meta.usage).toMatchObject({ uses: 7, wins: 2, lastUsed: '2026-01-01T00:00:00.000Z' });
    const now = new Date('2026-03-01T00:00:00.000Z');
    await brain.recordUse(['L-legacy'], now);
    expect(await readFile(legacy.path, 'utf8')).toBe(before);
    expect((await brain.read('L-legacy'))?.meta.usage).toMatchObject({ uses: 8, wins: 2, lastUsed: now.toISOString() });
    // A later feedback write keeps the frozen legacy counters, it does not advance them.
    await brain.feedback('L-legacy', false);
    expect(parseMarkdown<NoteMeta>(await readFile(legacy.path, 'utf8')).meta.usage).toMatchObject({ uses: 7, wins: 2, losses: 1, lastUsed: '2026-01-01T00:00:00.000Z' });
  });

  it('ranks with ledger recency (learned weight reads the merged usage)', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await seed(root, { id: 'L-stale', title: 'stale', usage: { uses: 1, wins: 0, losses: 0, lastUsed: '2020-01-01T00:00:00.000Z' } });
    const stale = (await brain.recall('stale body'))[0]!;
    expect(stale.why).toContain('learned weight 0.25');
    await brain.recordUse(['L-stale'], new Date(Date.now() + 120_000));
    expect((await brain.recall('stale body'))[0]!.why).not.toContain('learned weight 0.25');
  });

  it('maintain retires by merged usage: recent ledger exposure keeps a mixed-feedback lesson alive', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const usage = { uses: 5, wins: 2, losses: 3, lastUsed: '2026-01-01T00:00:00.000Z' };
    const created = new Date(now.getTime() - 10 * 86_400_000).toISOString();
    const quiet = await temp();
    await seed(quiet, { id: 'L-mixed', title: 'mixed', created, usage });
    expect((await openBrain([{ scope: 'project', root: quiet }]).maintain(now)).retired).toEqual(['L-mixed']);
    const exposed = await temp(); const brain = openBrain([{ scope: 'project', root: exposed }]);
    await seed(exposed, { id: 'L-mixed', title: 'mixed', created, usage });
    await brain.recordUse(['L-mixed'], new Date(now.getTime() - 86_400_000));
    expect((await brain.maintain(now)).retired).toEqual([]);
  });

  it('git-ignores the local folder on init and on the first ledger write, appending to an existing .gitignore', async () => {
    const root = await temp();
    await openBrain([{ scope: 'project', root }]).init({ scope: 'project', root });
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('.edu-local/\n');
    const other = await temp();
    await writeFile(join(other, '.gitignore'), 'node_modules');
    resetLedgerCache();
    const brain = openBrain([{ scope: 'project', root: other }]);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Ignored', body: 'x' });
    await brain.recordUse([note.meta.id]);
    expect(await readFile(join(other, '.gitignore'), 'utf8')).toBe('node_modules\n.edu-local/\n');
  });

  it('survives a corrupt ledger (moved aside, counting restarts)', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Corrupt', body: 'x' });
    await brain.recordUse([note.meta.id]);
    await appendFile(ledgerPath(root), '{not json');
    expect((await readLedger(root)).notes).toEqual({});
    await brain.recordUse([note.meta.id], new Date(Date.now() + 120_000));
    expect((await readLedger(root)).notes[note.meta.id]?.uses).toBe(1);
  });

  it('does not lose exposure across concurrent brain instances on one root', async () => {
    const root = await temp();
    const a = openBrain([{ scope: 'project', root }]), b = openBrain([{ scope: 'project', root }]);
    const note = await a.write({ tier: 'transitive', kind: 'lesson', title: 'Busy', body: 'x' });
    const base = Date.now();
    await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? a : b).recordUse([note.meta.id], new Date(base + i * 120_000))));
    expect((await readLedger(root)).notes[note.meta.id]?.uses).toBe(16);
  });

  it('merges by max so an older Edu still bumping frontmatter elsewhere is not lost', () => {
    expect(mergeExposure({ uses: 9, wins: 1, losses: 0, lastUsed: '2026-02-01T00:00:00Z' }, { uses: 3, lastUsed: '2026-01-01T00:00:00Z' }))
      .toEqual({ uses: 9, wins: 1, losses: 0, lastUsed: '2026-02-01T00:00:00Z' });
    expect(mergeExposure(undefined, { uses: 2 })).toEqual({ uses: 2, wins: 0, losses: 0 });
    expect(frontmatterUsage({ uses: 5, wins: 0, losses: 0, lastUsed: 'x' }, undefined, false)).toBeUndefined();
  });
});
