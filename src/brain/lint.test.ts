import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrainLocation, Note, NoteMeta } from '../core/contracts.js';
import { brainPath } from './location.js';
import * as store from './store.js';
import { openBrain } from './brain.js';
import { lintBrain, lintNotes, timeSensitivePhrases } from './lint.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const NOW = new Date('2026-11-08T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString();

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'edu-lint-')); dirs.push(root);
  const loc: BrainLocation = { scope: 'project', root };
  return { loc, brain: openBrain([loc]) };
}

async function seed(loc: BrainLocation, meta: Partial<NoteMeta> & Pick<NoteMeta, 'title' | 'tier'>, body = ''): Promise<Note> {
  const full: NoteMeta = { id: store.createId({ tier: meta.tier, kind: meta.kind, title: meta.title }), tags: [], links: [], created: daysAgo(10), updated: NOW.toISOString(), ...meta };
  const note: Note = { meta: full, body, path: store.notePath(brainPath(loc), full, new Date(full.created)) };
  await store.atomicWrite(note.path, store.encodeNote(note));
  return note;
}

/** A small, healthy brain: everything linked, no time-sensitive claims, no duplicates. */
async function cleanBrain(loc: BrainLocation) {
  const decision = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Write notes atomically', created: daysAgo(200) }, 'Temp file then rename, so a crash never leaves half a note. See [[L-retry-renames-on-windows]].');
  const lesson = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Retry renames on Windows' }, 'Antivirus holds handles briefly; back off and retry the rename.');
  const standard = await seed(loc, { tier: 'canonical', kind: 'standard', status: 'accepted', title: 'Small pull requests', created: daysAgo(300), links: [decision.meta.id] }, 'Keep pull requests under four hundred lines.');
  await seed(loc, { tier: 'episodic', kind: 'session', status: 'closed', title: 'Session one', links: [lesson.meta.id, standard.meta.id] }, 'Fixed the rename race.');
  return { decision, lesson, standard };
}

describe('brain lint', () => {
  it('reports nothing on a clean brain', async () => {
    const { loc, brain } = await setup();
    await cleanBrain(loc);
    const report = await lintBrain(brain, { now: NOW, root: brainPath(loc) });
    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.notes).toBe(4);
  });

  it('finds orphans and missing pages, resolving links by id, alias and title', async () => {
    const { loc, brain } = await setup();
    await cleanBrain(loc);
    const orphan = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Lonely lesson' }, 'Nobody links here.');
    await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'retired', title: 'Retired and alone' }, 'Not live: never an orphan.');
    const aliased = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Aliased note', aliases: ['old-name'] }, 'Linked by its alias.');
    const linker = await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', title: 'Linker' }, 'See [[old-name]], [[Write notes atomically]] and [[never-written|a label]].');
    const report = lintNotes(await brain.list(), { now: NOW });
    expect(report.findings.filter(f => f.kind === 'orphan').map(f => f.ids[0])).toEqual([orphan.meta.id]);
    const missing = report.findings.filter(f => f.kind === 'missing-page');
    expect(missing).toEqual([expect.objectContaining({ target: 'never-written', ids: [linker.meta.id], severity: 'warning' })]);
    expect(report.findings.some(f => f.ids.includes(aliased.meta.id))).toBe(false);
  });

  it('flags possible contradictions between active decisions with negation or different values, never superseded pairs', async () => {
    const { loc, brain } = await setup();
    await cleanBrain(loc);
    const a = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Deploy previews on every pull request', created: daysAgo(20), links: ['D-write-notes-atomically'] }, 'Deploy previews on every pull request so reviewers see the change.');
    const b = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Deploy previews on pull requests', created: daysAgo(5), links: ['D-write-notes-atomically'] }, 'Never deploy previews on every pull request: they cost too much.');
    const c = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Database for the ledger service', created: daysAgo(30), links: ['D-write-notes-atomically'] }, 'database: postgres\nThe ledger service database choice.');
    const d = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Database for the ledger service v2', created: daysAgo(3), links: ['D-write-notes-atomically'] }, 'database: sqlite\nThe ledger service database choice.');
    const report = lintNotes(await brain.list(), { now: NOW });
    const contradictions = report.findings.filter(f => f.kind === 'contradiction');
    expect(contradictions.map(f => f.ids)).toEqual(expect.arrayContaining([[a.meta.id, b.meta.id], [c.meta.id, d.meta.id]]));
    expect(contradictions).toHaveLength(2);
    expect(contradictions.every(f => f.message.startsWith('Possible contradiction'))).toBe(true);
    expect(contradictions.find(f => f.ids[0] === c.meta.id)?.evidence?.[0]).toContain('"postgres" vs "sqlite"');
  });

  it('flags stale time-sensitive claims without an as-of marker, and overdue commitments', async () => {
    const { loc, brain } = await setup();
    await cleanBrain(loc);
    const stale = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Pin the runtime', created: daysAgo(120), links: ['D-write-notes-atomically'] }, 'We currently pin Node 22.19 and pay $20 per seat.');
    await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Pin the compiler', created: daysAgo(120), links: ['D-write-notes-atomically'] }, 'We use TypeScript 5.9 (as of 2026-10-01).');
    await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Pin the linter', created: daysAgo(30), links: ['D-write-notes-atomically'] }, 'Hoy usamos la versión 9.1.');
    const overdue = await seed(loc, { tier: 'transitive', kind: 'commitment', status: 'pending', title: 'Send the report', due: '2026-11-01', links: ['D-write-notes-atomically'] }, 'For the board.');
    await seed(loc, { tier: 'transitive', kind: 'commitment', status: 'delivered', title: 'Sent the slides', due: '2026-10-01', links: ['D-write-notes-atomically'] }, 'Done.');
    const report = lintNotes(await brain.list(), { now: NOW, staleDays: 90 });
    const staleFindings = report.findings.filter(f => f.kind === 'stale-claim');
    expect(staleFindings.map(f => f.ids[0])).toEqual([stale.meta.id]);
    expect(staleFindings[0]!.evidence).toEqual(expect.arrayContaining(['currently', '22.19', '$20']));
    expect(report.findings.filter(f => f.kind === 'overdue')).toEqual([expect.objectContaining({ ids: [overdue.meta.id], severity: 'error' })]);
    expect(timeSensitivePhrases('Actualmente el último precio es 30 euros')).toEqual(expect.arrayContaining(['actualmente', 'ultimo', '30 euros']));
  });

  it('finds duplicates by normalized title and body, ignoring episodes', async () => {
    const { loc, brain } = await setup();
    await cleanBrain(loc);
    const first = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Check the PATH first', created: daysAgo(9), links: ['D-write-notes-atomically'] }, 'When a CLI is missing, check PATH before reinstalling.');
    const second = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Look at PATH before reinstalling', created: daysAgo(2), links: ['D-write-notes-atomically'] }, 'When a CLI is missing — check PATH before reinstalling.');
    await seed(loc, { tier: 'episodic', kind: 'session', status: 'closed', title: 'Session two', links: [first.meta.id] }, 'Fixed the rename race.');
    const report = lintNotes(await brain.list(), { now: NOW });
    const duplicates = report.findings.filter(f => f.kind === 'duplicate');
    expect(duplicates).toEqual([expect.objectContaining({ ids: [first.meta.id, second.meta.id], severity: 'error' })]);
    expect(report.summary).toMatchObject({ duplicate: 1, error: 1, total: 1 });
    // Same normalized title in two tiers (a lesson and its canonical standard) is a warning.
    await seed(loc, { tier: 'canonical', kind: 'standard', status: 'accepted', title: 'Check the PATH first', links: [first.meta.id] }, 'Always check PATH.');
    const again = lintNotes(await brain.list(), { now: NOW }).findings.filter(f => f.kind === 'duplicate');
    expect(again).toHaveLength(2);
    expect(again.find(f => f.evidence?.[0] === 'same title')?.severity).toBe('warning');
  });

  it('reports only notes inside the given root but resolves links across every location', async () => {
    const { loc } = await setup();
    const globalRoot = await mkdtemp(join(tmpdir(), 'edu-lint-global-')); dirs.push(globalRoot);
    const global: BrainLocation = { scope: 'global', root: globalRoot };
    const shared = await seed(global, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Shared lesson' }, 'Lives in the global brain.');
    await seed(global, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Global orphan' }, 'Not reported for the project.');
    await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Project lesson' }, `Builds on [[${shared.meta.id}]].`);
    const report = await lintBrain(openBrain([loc, global]), { now: NOW, root: brainPath(loc) });
    expect(report.findings).toEqual([]);
  });
});
