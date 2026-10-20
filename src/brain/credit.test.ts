import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackContext, Note, NoteMeta } from '../core/contracts.js';
import { openBrain } from './brain.js';
import { brainPath } from './location.js';
import { atomicFs, atomicWrite, encodeNote, notePath, resetNoteCache } from './store.js';
import { parseMarkdown } from './frontmatter.js';
import { buildContext } from '../context/pack.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-credit-')); dirs.push(path); return path; }
afterEach(async () => { resetNoteCache(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const day = 86_400_000;
const ev = (eventId: string, verified = true): FeedbackContext => ({ eventId, verified });

async function lesson(brain: ReturnType<typeof openBrain>, title: string, extra: Partial<Parameters<ReturnType<typeof openBrain>['write']>[0]> = {}) {
  return brain.write({ title, body: `${title} body`, tier: 'transitive', kind: 'lesson', ...extra });
}

describe('credit: feedback and promotion', () => {
  it('legacy/advisory feedback (any number of votes) never promotes', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Advisory only');
    for (let i = 0; i < 5; i++) await brain.feedback(l.meta.id, true);
    for (let i = 0; i < 5; i++) await brain.feedback(l.meta.id, true, ev(`adv-${i}`, false));
    const report = await brain.maintain();
    expect(report.promoted).toEqual([]);
    expect((await brain.read(l.meta.id))?.meta.status).toBe('candidate');
    expect((await brain.read(l.meta.id))?.meta.usage).toMatchObject({ wins: 10 });
  });

  it('keeps feedback(id, bool) as advisory without fabricating verification or renewing exposure', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Compat');
    const note = await brain.feedback(l.meta.id, true);
    expect(note.meta.usage).toEqual({ uses: 0, wins: 1, losses: 0 });
  });

  it('dedupes contextual feedback by eventId and promotes only after 3 distinct verified events', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Verified path');
    for (let i = 0; i < 4; i++) await brain.feedback(l.meta.id, true, ev('run-1'));
    await brain.feedback(l.meta.id, true, ev('run-2'));
    expect((await brain.read(l.meta.id))?.meta.usage).toMatchObject({ wins: 2, verifiedWins: 2 });
    expect((await brain.maintain()).promoted).toEqual([]);
    await brain.feedback(l.meta.id, true, ev('run-3'));
    expect((await brain.maintain()).promoted).toEqual([l.meta.id]);
    expect((await brain.read(l.meta.id))?.meta.status).toBe('proven');
  });

  it('upgrades an advisory event to verified without double counting', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Upgrade');
    await brain.feedback(l.meta.id, true, ev('e1', false));
    await brain.feedback(l.meta.id, true, ev('e1', true));
    await brain.feedback(l.meta.id, true, ev('e1', false));
    expect((await brain.read(l.meta.id))?.meta.usage).toMatchObject({ wins: 1, verifiedWins: 1 });
  });

  it('a verified failure blocks promotion that 3 wins plus 1 loss would not justify', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Mixed');
    for (const id of ['a', 'b', 'c']) await brain.feedback(l.meta.id, true, ev(id));
    await brain.feedback(l.meta.id, false, ev('d'));
    expect((await brain.maintain()).promoted).toEqual([]);
  });

  it('rejects malformed contexts at runtime, including a "false" string for verified', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Strict');
    const bad = [{ eventId: ' ', verified: true }, { eventId: 'x'.repeat(201), verified: true }, { eventId: 5, verified: true }, { eventId: 'ok', verified: 'false' }, { eventId: 'ok', verified: 1 }, { eventId: 'ok' }, { eventId: 'ok', verified: true, evidence: 'a' }, null];
    for (const context of bad) await expect(brain.feedback(l.meta.id, true, context as never)).rejects.toThrow(/context|eventId|verified|evidence/i);
    expect((await brain.read(l.meta.id))?.meta.usage).toBeUndefined();
  });

  it('stays idempotent when an old event is replayed after more than 200 distinct events', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Many events');
    for (let i = 0; i < 230; i++) await brain.feedback(l.meta.id, i % 2 === 0, ev(`e${i}`, i % 3 === 0));
    const before = (await brain.read(l.meta.id))!.meta.usage!;
    for (const i of [0, 1, 2, 3, 100, 229]) {
      await brain.feedback(l.meta.id, i % 2 === 0, ev(`e${i}`, i % 3 === 0));
      await brain.feedback(l.meta.id, true, ev(`e${i}`, true));
    }
    const after = (await brain.read(l.meta.id))!.meta.usage!;
    // replaying as verified may only upgrade advisory events that were never verified; recount from a fresh replay
    const again = (await (async () => { for (let i = 0; i < 230; i++) await brain.feedback(l.meta.id, true, ev(`e${i}`, true)); return brain.read(l.meta.id); })())!.meta.usage!;
    expect(after.wins).toBe(before.wins);
    expect(after.losses).toBe(before.losses);
    expect(after.events!.length).toBe(230);
    expect(again.wins).toBe(before.wins);
    expect(again.losses).toBe(before.losses);
    expect(again.verifiedWins).toBeGreaterThan(before.verifiedWins!);
  });

  it('tolerates malformed legacy usage metadata without treating it as proof', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Weird');
    const raw = (await brain.read(l.meta.id))!;
    await atomicWrite(raw.path, encodeNote({ ...raw, meta: { ...raw.meta, usage: { uses: 'x', wins: 3, losses: 0, verifiedWins: 'lots', events: 'nope' } as never } }));
    expect((await brain.maintain()).promoted).toEqual([]);
    const note = await brain.feedback(l.meta.id, true, ev('after'));
    expect(note.meta.usage).toMatchObject({ wins: 4, verifiedWins: 1, events: ['v:after'] });
  });

  it('round-trips the new usage fields through frontmatter on disk', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Frontmatter');
    await brain.feedback(l.meta.id, true, ev('12345'));
    const written = parseMarkdown<NoteMeta>(await readFile(l.path, 'utf8')).meta;
    expect(written.usage?.events).toEqual(['v:12345']);
    expect(written.usage?.verifiedWins).toBe(1);
    resetNoteCache();
    expect((await openBrain([{ scope: 'project', root }]).read(l.meta.id))?.meta.usage?.lastVerified).toBeTruthy();
  });
});

describe('credit: legacy data and aging', () => {
  async function seedLesson(root: string, meta: Partial<NoteMeta> & Pick<NoteMeta, 'id' | 'title'>) {
    const full: NoteMeta = { tier: 'transitive', kind: 'lesson', status: 'candidate', tags: [], links: [], created: new Date().toISOString(), source: 'import', ...meta };
    const note: Note = { meta: full, body: 'legacy body', path: notePath(brainPath({ scope: 'project', root }), full) };
    await atomicWrite(note.path, encodeNote(note)); return note;
  }

  it('preserves a historical proven lesson, including after long inactivity', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await seedLesson(root, { id: 'L-old-proven', title: 'old proven', status: 'proven', created: '2024-01-01T00:00:00Z', usage: { uses: 9, wins: 5, losses: 0, lastUsed: '2024-06-01T00:00:00Z' } });
    const report = await brain.maintain(new Date('2026-10-01T00:00:00Z'));
    expect(report.retired).toEqual([]);
    expect((await brain.read('L-old-proven'))?.meta).toMatchObject({ status: 'proven', usage: { wins: 5 } });
  });

  it('does not retire a verified, still-valid candidate for inactivity', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await seedLesson(root, { id: 'L-verified', title: 'verified quiet', created: '2025-01-01T00:00:00Z', usage: { uses: 1, wins: 1, losses: 0, verifiedWins: 1, lastVerified: '2025-02-01T00:00:00Z' } });
    expect((await brain.maintain(new Date('2026-10-01T00:00:00Z'))).retired).toEqual([]);
  });

  it('ages an unconfirmed candidate even if it keeps being exposed (use does not renew life)', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const now = new Date('2026-10-01T00:00:00Z');
    await seedLesson(root, { id: 'L-exposed', title: 'exposed unconfirmed', created: new Date(now.getTime() - 200 * day).toISOString() });
    await brain.recordUse(['L-exposed'], new Date(now.getTime() - day));
    const report = await brain.maintain(now);
    expect(report.retired).toEqual(['L-exposed']);
    // advisory feedback does not renew it either
    await seedLesson(root, { id: 'L-advised', title: 'advised unconfirmed', created: new Date(now.getTime() - 200 * day).toISOString() });
    await brain.feedback('L-advised', true);
    expect((await brain.maintain(now)).retired).toEqual(['L-advised']);
  });

  it('keeps a young unconfirmed candidate', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await seedLesson(root, { id: 'L-young', title: 'young', created: new Date(Date.now() - 10 * day).toISOString() });
    expect((await brain.maintain()).retired).toEqual([]);
  });
});

describe('credit: lesson supersedes', () => {
  it('retires the old lesson at write time and links it, leaving accepted canonical untouched', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const old = await lesson(brain, 'Use npm');
    const canon = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Pkg standard', body: 'npm', links: [old.meta.id] });
    await brain.acceptCanonical(canon.meta.id);
    const canonBefore = await readFile(canon.path, 'utf8');
    const next = await lesson(brain, 'Use pnpm', { supersedes: old.meta.id });
    expect((await brain.read(old.meta.id))?.meta).toMatchObject({ status: 'retired', superseded_by: next.meta.id });
    expect((await brain.read(next.meta.id))?.meta.status).toBe('candidate');
    expect(await readFile(canon.path, 'utf8')).toBe(canonBefore);
    // retired lesson is no longer injected into context
    const pack = await buildContext(brain, { query: 'Use npm pnpm', budgetTokens: 2000 } as never);
    expect(JSON.stringify(pack)).not.toContain('Use npm body');
  });

  it('maintain detects an existing supersedes link, is idempotent, and ignores a canonical or mutual target', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const a = await lesson(brain, 'Alpha'); const b = await lesson(brain, 'Beta');
    // simulate pre-existing data: supersedes written straight to disk
    const raw = (await brain.read(b.meta.id))!;
    await atomicWrite(raw.path, encodeNote({ ...raw, meta: { ...raw.meta, supersedes: a.meta.id } }));
    const first = await brain.maintain();
    expect(first.retired).toEqual([a.meta.id]);
    expect((await brain.maintain()).retired).toEqual([]);
    expect((await brain.read(b.meta.id))?.meta.status).toBe('candidate');
    // supersedes pointing at a canonical note does nothing to it
    const canon = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Std', body: 'x' });
    await brain.acceptCanonical(canon.meta.id);
    const c = await lesson(brain, 'Gamma');
    const rawC = (await brain.read(c.meta.id))!;
    await atomicWrite(rawC.path, encodeNote({ ...rawC, meta: { ...rawC.meta, supersedes: canon.meta.id } }));
    await brain.maintain();
    expect((await brain.read(canon.meta.id))?.meta.status).toBe('accepted');
  });
});

describe('credit: project/global isolation', () => {
  it('feedback on a global lesson writes a project copy and leaves the global file untouched; canonical is never copied', async () => {
    const globalRoot = await temp(); const projectRoot = await temp();
    const g = { scope: 'global' as const, root: globalRoot }, p = { scope: 'project' as const, root: projectRoot };
    await mkdir(brainPath(p), { recursive: true });
    const globalBrain = openBrain([g]);
    const gl = await lesson(globalBrain, 'Global lesson');
    const canon = await globalBrain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Global std', body: 's' });
    await globalBrain.acceptCanonical(canon.meta.id);
    const before = await readFile(gl.path, 'utf8');
    const both = openBrain([p, g]);
    await both.feedback(gl.meta.id, true, ev('p1'));
    await both.feedback(canon.meta.id, true);
    expect(await readFile(gl.path, 'utf8')).toBe(before);
    expect((await both.read(gl.meta.id))?.meta.usage).toMatchObject({ verifiedWins: 1 });
    expect((await both.read(gl.meta.id))?.path.startsWith(brainPath(p))).toBe(true);
    expect((await openBrain([g]).read(gl.meta.id))?.meta.usage).toBeUndefined();
    expect((await openBrain([p]).list({ tier: 'canonical' }))).toEqual([]);
    // repeating the same event after the overlay exists stays idempotent
    await both.feedback(gl.meta.id, true, ev('p1'));
    expect((await both.read(gl.meta.id))?.meta.usage?.wins).toBe(1);
  });
});

describe('credit: concurrency and shadow collisions', () => {
  it('keeps every event when two brain instances give feedback concurrently', async () => {
    const root = await temp();
    const a = openBrain([{ scope: 'project', root }]), b = openBrain([{ scope: 'project', root }]);
    const l = await lesson(a, 'Concurrent');
    await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? a : b).feedback(l.meta.id, true, ev(`run-${i}`))));
    await Promise.all([a, b].map(brain => brain.feedback(l.meta.id, true, ev('run-3'))));
    const usage = (await a.read(l.meta.id))!.meta.usage!;
    expect(usage).toMatchObject({ wins: 24, verifiedWins: 24 });
    expect([...usage.events!].sort()).toEqual(Array.from({ length: 24 }, (_, i) => `v:run-${i}`).sort());
  });

  it('does not lose feedback events to a concurrent recordUse or recall', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const l = await lesson(brain, 'Mixed writers');
    await Promise.all(Array.from({ length: 10 }, (_, i) => Promise.all([
      brain.feedback(l.meta.id, true, ev(`m-${i}`)),
      brain.recordUse([l.meta.id], new Date(Date.now() + i * 120_000)),
    ])));
    expect((await brain.read(l.meta.id))!.meta.usage).toMatchObject({ verifiedWins: 10, wins: 10 });
  });

  it('never overwrites a different local note that occupies the shadow path (same title, imported id)', async () => {
    const globalRoot = await temp(); const projectRoot = await temp();
    const g = { scope: 'global' as const, root: globalRoot }, p = { scope: 'project' as const, root: projectRoot };
    const local = await lesson(openBrain([p]), 'Shared title', { });
    await atomicWrite(local.path, encodeNote({ ...local, body: 'PROJECT UNIQUE CONTENT' }));
    const globalMeta: NoteMeta = { id: 'L-imported-uuid', tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Shared title', tags: [], links: [], created: '2026-01-01T00:00:00.000Z', source: 'import' };
    const importedPath = join(brainPath(g), '3-transitive', 'imported.md');
    await atomicWrite(importedPath, encodeNote({ meta: globalMeta, body: 'GLOBAL OTHER CONTENT', path: importedPath }));
    const localBytes = await readFile(local.path, 'utf8'), globalBytes = await readFile(importedPath, 'utf8');
    const both = openBrain([p, g]);
    await both.feedback('L-imported-uuid', true, ev('x1'));
    await both.feedback('L-imported-uuid', true, ev('x1'));
    expect(await readFile(local.path, 'utf8')).toBe(localBytes);
    expect(await readFile(importedPath, 'utf8')).toBe(globalBytes);
    expect((await both.read(local.meta.id))?.body).toBe('PROJECT UNIQUE CONTENT');
    const shadow = (await both.read('L-imported-uuid'))!;
    expect(shadow.body).toBe('GLOBAL OTHER CONTENT');
    expect(shadow.path).not.toBe(local.path);
    expect(shadow.meta.usage).toMatchObject({ wins: 1, verifiedWins: 1 });
  });
});

describe('credit: shared global across project views', () => {
  it('two project views and the global instance writing concurrently never lose the global ledger', async () => {
    const globalRoot = await temp(), aRoot = await temp(), bRoot = await temp();
    const g = { scope: 'global' as const, root: globalRoot };
    const globalBrain = openBrain([g]);
    const gl = await lesson(globalBrain, 'Shared global lesson');
    const viewA = openBrain([{ scope: 'project', root: aRoot }, g]), viewB = openBrain([{ scope: 'project', root: bRoot }, g]);
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 12; i++) {
      work.push(globalBrain.feedback(gl.meta.id, true, ev(`global-${i}`)));
      work.push((i % 2 ? viewA : viewB).recordUse([gl.meta.id], new Date(Date.now() + i * 120_000)));
      work.push((i % 2 ? viewA : viewB).recall('Shared global lesson'));
    }
    await Promise.all(work);
    const usage = (await openBrain([g]).read(gl.meta.id))!.meta.usage!;
    expect(usage.verifiedWins).toBe(12);
    expect([...usage.events!].sort()).toEqual(Array.from({ length: 12 }, (_, i) => `v:global-${i}`).sort());
  });

  it('project feedback creates only a project shadow while the global is written by others, each ledger intact', async () => {
    const globalRoot = await temp(), aRoot = await temp(), bRoot = await temp();
    const g = { scope: 'global' as const, root: globalRoot };
    const globalBrain = openBrain([g]);
    const gl = await lesson(globalBrain, 'Another shared lesson');
    const viewA = openBrain([{ scope: 'project', root: aRoot }, g]), viewB = openBrain([{ scope: 'project', root: bRoot }, g]);
    await Promise.all(Array.from({ length: 8 }, (_, i) => [
      globalBrain.feedback(gl.meta.id, true, ev(`g-${i}`)),
      viewA.feedback(gl.meta.id, true, ev(`a-${i}`)),
      viewB.feedback(gl.meta.id, false, ev(`b-${i}`)),
      viewA.recordUse([gl.meta.id], new Date(Date.now() + i * 120_000)),
    ]).flat());
    const events = async (roots: typeof g[]) => [...((await openBrain(roots).read(gl.meta.id))!.meta.usage!.events ?? [])].sort();
    expect(await events([g])).toEqual(Array.from({ length: 8 }, (_, i) => `v:g-${i}`).sort());
    // A's shadow copy (created from whatever the global held at the time) holds all of A's events exactly once.
    const a = await events([{ scope: 'project', root: aRoot }, g]);
    expect(a.filter(key => key.startsWith('v:a-')).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `v:a-${i}`).sort());
    const b = await events([{ scope: 'project', root: bRoot }, g]);
    expect(b.filter(key => key.startsWith('v:b-')).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `v:b-${i}`).sort());
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('core atomicity: update and create', () => {
  it('closeSession from two instances with different summaries: exactly one confirms, the other sees immutable', async () => {
    for (let round = 0; round < 5; round++) {
      const root = await temp();
      const a = openBrain([{ scope: 'project', root }]), b = openBrain([{ scope: 'project', root }]);
      const session = await a.openSession(`Session ${round}`, 'test');
      const results = await Promise.allSettled([a.closeSession(session.meta.id, 'summary from A'), b.closeSession(session.meta.id, 'summary from B')]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      expect(String(failed.reason)).toMatch(/immutable/i);
      const winner = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Note>).value;
      expect((await a.read(session.meta.id))?.body).toBe(winner.body);
    }
  });

  it('parallel creation of the same identity from two instances: one wins, the other is rejected, the winner is not overwritten', async () => {
    for (let round = 0; round < 5; round++) {
      const root = await temp();
      const a = openBrain([{ scope: 'project', root }]), b = openBrain([{ scope: 'project', root }]);
      const results = await Promise.allSettled([
        a.write({ title: `Same title ${round}`, body: 'BODY A', tier: 'transitive', kind: 'lesson' }),
        b.write({ title: `Same title ${round}`, body: 'BODY B', tier: 'transitive', kind: 'lesson' }),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/already exists/);
      const winner = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Note>).value;
      expect((await a.read(winner.meta.id))?.body).toBe(winner.body);
    }
  });

  it('lifecycle effects after create still apply (lesson supersedes, decision reversion) without deadlock', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const d1 = await brain.write({ title: 'Decide one', body: 'x', tier: 'transitive', kind: 'decision' });
    const d2 = await brain.write({ title: 'Decide two', body: 'y', tier: 'transitive', kind: 'decision', supersedes: d1.meta.id });
    expect((await brain.read(d1.meta.id))?.meta).toMatchObject({ status: 'reverted', supersedes: d2.meta.id });
    const o = await lesson(brain, 'Old way'); await lesson(brain, 'New way', { supersedes: o.meta.id });
    expect((await brain.read(o.meta.id))?.meta.status).toBe('retired');
  });
});

describe('core atomicity: aliased roots', () => {
  it('two locations that alias the same root (junction/symlink) do not deadlock on the usage lock', async () => {
    const real = await temp(); const holder = await temp();
    const alias = join(holder, 'alias-to-root');
    await symlink(real, alias, 'junction'); // junctions need no privilege on Windows
    const a = { scope: 'project' as const, root: alias };
    const b = { scope: 'global' as const, root: real, brainDir: join(real, 'other-brain') };
    const viaA = openBrain([a]), viaB = openBrain([b]);
    const first = await lesson(viaA, 'Aliased one'), second = await lesson(viaB, 'Aliased two');
    const both = openBrain([a, b]);
    const started = Date.now();
    // One batch touches files whose roots are spelled differently but are the same directory.
    await Promise.all([both.recordUse([first.meta.id, second.meta.id]), both.feedback(second.meta.id, true, ev('x1')), openBrain([{ scope: 'project', root: real, brainDir: join(real, 'other-brain') }]).feedback(second.meta.id, true, ev('x2'))]);
    expect(Date.now() - started).toBeLessThan(5000);
    // x2 went to the global file; x1 to the primary's shadow copy (isolation), neither lost.
    expect((await viaB.read(second.meta.id))!.meta.usage!.events).toContain('v:x2');
    expect((await both.read(second.meta.id))!.meta.usage!.events).toContain('v:x1');
  });
});

describe('core atomicity: compound supersedes', () => {
  it('two new decisions superseding the same active decision: exactly one wins, no orphan, old points to the winner', async () => {
    for (let round = 0; round < 5; round++) {
      const root = await temp();
      const a = openBrain([{ scope: 'project', root }]), b = openBrain([{ scope: 'project', root }]);
      const old = await a.write({ title: `Old decision ${round}`, body: 'old', tier: 'transitive', kind: 'decision' });
      const results = await Promise.allSettled([
        a.write({ title: `New A ${round}`, body: 'A', tier: 'transitive', kind: 'decision', supersedes: old.meta.id }),
        b.write({ title: `New B ${round}`, body: 'B', tier: 'transitive', kind: 'decision', supersedes: old.meta.id }),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/active decision/);
      const winner = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Note>).value;
      const decisions = await a.list({ kind: 'decision' });
      expect(decisions.filter(d => d.meta.status === 'active').map(d => d.meta.id)).toEqual([winner.meta.id]);
      expect(decisions).toHaveLength(2);
      expect((await b.read(old.meta.id))?.meta).toMatchObject({ status: 'reverted', supersedes: winner.meta.id });
    }
  });

  it('a failed revert leaves no orphan new decision and keeps the old one active', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const old = await brain.write({ title: 'Old d', body: 'old', tier: 'transitive', kind: 'decision' });
    const rename = vi.spyOn(atomicFs, 'rename');
    let calls = 0;
    rename.mockImplementation(async (...args) => { if (++calls === 2) throw Object.assign(new Error('disk failure'), { code: 'EIO' }); return (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename(...args); });
    try { await expect(brain.write({ title: 'New d', body: 'new', tier: 'transitive', kind: 'decision', supersedes: old.meta.id })).rejects.toThrow(/disk failure/); }
    finally { rename.mockRestore(); }
    expect((await brain.list({ kind: 'decision' })).map(d => d.meta.id)).toEqual([old.meta.id]);
    expect((await brain.read(old.meta.id))?.meta.status).toBe('active');
  });

  it('two proposals replacing the same accepted standard: one accept wins, the competitor is rejected without effects', async () => {
    for (let round = 0; round < 5; round++) {
      const root = await temp();
      const a = openBrain([{ scope: 'project', root }]), b = openBrain([{ scope: 'project', root }]);
      const old = await a.proposeCanonical({ tier: 'canonical', kind: 'standard', title: `Std ${round}`, body: 'v1' });
      await a.acceptCanonical(old.meta.id);
      const p1 = await a.proposeCanonical({ tier: 'canonical', kind: 'standard', title: `Std ${round} rev one`, body: 'v2', supersedes: old.meta.id });
      const p2 = await a.proposeCanonical({ tier: 'canonical', kind: 'standard', title: `Std ${round} rev two`, body: 'v3', supersedes: old.meta.id });
      const results = await Promise.allSettled([a.acceptCanonical(p1.meta.id), b.acceptCanonical(p2.meta.id)]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/already superseded/);
      const statuses = Object.fromEntries((await a.list({ tier: 'canonical' })).map(n => [n.meta.id, n.meta.status]));
      expect(Object.values(statuses).filter(status => status === 'accepted')).toHaveLength(1);
      expect(statuses[old.meta.id]).toBe('superseded');
      expect(Object.values(statuses).filter(status => status === 'proposed')).toHaveLength(1);
    }
  });
});
