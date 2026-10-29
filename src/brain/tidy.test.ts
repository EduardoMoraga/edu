import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrainLocation, Note, NoteMeta } from '../core/contracts.js';
import { brainPath } from './location.js';
import * as store from './store.js';
import { openBrain } from './brain.js';
import { applyTidy, loadTidyPlan, planTidy, saveTidyPlan, tidyPlanPath } from './tidy.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const NOW = new Date('2026-10-29T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString();

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'edu-tidy-')); dirs.push(root);
  const loc: BrainLocation = { scope: 'project', root };
  return { loc, brain: openBrain([loc]) };
}

/** Writes a note to disk exactly as hooks and importers leave it, bypassing `brain.write` (which stamps `created` now). */
async function seed(loc: BrainLocation, meta: Partial<NoteMeta> & Pick<NoteMeta, 'title' | 'tier'>, body = ''): Promise<Note> {
  const full: NoteMeta = { id: store.createId({ tier: meta.tier, kind: meta.kind, title: meta.title }), tags: [], links: [], created: daysAgo(40), updated: NOW.toISOString(), ...meta };
  const note: Note = { meta: full, body, path: store.notePath(brainPath(loc), full, new Date(full.created)) };
  await store.atomicWrite(note.path, store.encodeNote(note));
  return note;
}

describe('brain tidy', () => {
  it('plans empty old sessions, hypotheses stale by creation date and aliases from import origin, without writing', async () => {
    const { loc, brain } = await setup();
    const empty = await seed(loc, { tier: 'episodic', kind: 'session', status: 'open-session', title: 'Claude Code session aaaa1111' });
    await seed(loc, { tier: 'episodic', kind: 'session', status: 'open-session', title: 'Live session', created: daysAgo(0.1) });
    await seed(loc, { tier: 'episodic', kind: 'session', status: 'open-session', title: 'Session with notes' }, 'Did something.');
    await seed(loc, { tier: 'episodic', kind: 'session', status: 'closed', title: 'Closed session' }, 'Summary.');
    // Recently "updated" by context injection, but created 40 days ago: still stale.
    const stale = await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', band: 'hypothesis', title: 'Old idea' }, 'Why.');
    await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', band: 'hypothesis', title: 'Fresh idea', created: daysAgo(5) }, 'Why.');
    const lesson = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Verify the environment', origin: 'albert:3-TRANSITIVO/aprendizajes/L-006_verificar-entorno.md' }, 'Check first.');
    const canonical = await seed(loc, { tier: 'canonical', kind: 'domain', status: 'accepted', title: 'Fronts 2026', origin: 'albert:1-CANONICO/negocio/frentes-2026.md' }, 'Fronts.');
    await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Uses old names' }, 'See [[L-006_verificar-entorno]], [[frentes-2026|fronts]] and [[never-written]].');

    const plan = await planTidy(brain, loc, { now: NOW });
    expect(plan.sessions.map(s => s.id)).toEqual([empty.meta.id]);
    expect(plan.hypotheses.map(h => h.id)).toEqual([stale.meta.id]);
    expect(plan.aliases).toEqual([{ id: lesson.meta.id, title: 'Verify the environment', add: ['L-006_verificar-entorno'] }]);
    expect(plan.manual).toEqual([{ link: 'frentes-2026', target: canonical.meta.id, reason: 'accepted canonical notes are immutable' }]);
    expect(plan.unresolved).toBe(1);
    expect((await brain.list()).length).toBe(9);
  });

  it('keeps an empty session that another note links to', async () => {
    const { loc, brain } = await setup();
    const empty = await seed(loc, { tier: 'episodic', kind: 'session', status: 'open-session', title: 'Pi session bbbb2222' });
    await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Points at it' }, `From [[${empty.meta.id}]].`);
    expect((await planTidy(brain, loc, { now: NOW })).sessions).toEqual([]);
  });

  it('applies only the saved plan, backs up every changed file and goes through the lifecycle', async () => {
    const { loc, brain } = await setup();
    const empty = await seed(loc, { tier: 'episodic', kind: 'session', status: 'open-session', title: 'Claude Code session cccc3333' });
    const keep = await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', band: 'inferred', title: 'Keep this one' }, 'Still relevant.');
    const close = await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', band: 'inferred', title: 'Close this one' }, 'Nobody came back.');
    const lesson = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Old name lesson', origin: 'albert:x/L-9_old-name.md', aliases: ['L-9'] }, 'Text.');
    await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Linker' }, 'See [[L-9_old-name]].');

    await saveTidyPlan(loc, await planTidy(brain, loc, { now: NOW }));
    // The human drops one hypothesis from the plan before applying.
    const edited = (await loadTidyPlan(loc))!;
    edited.hypotheses = edited.hypotheses.filter(h => h.id !== keep.meta.id);
    await writeFile(tidyPlanPath(loc), JSON.stringify(edited));

    const result = await applyTidy(brain, loc, (await loadTidyPlan(loc))!, { now: NOW });
    expect(result).toMatchObject({ sessions: 1, hypotheses: 1, aliases: 1, skipped: [] });
    expect(await brain.read(empty.meta.id)).toBeUndefined();
    expect((await brain.read(close.meta.id))?.meta.status).toBe('no-evidence');
    expect((await brain.read(keep.meta.id))?.meta.status).toBe('open');
    expect((await brain.read(lesson.meta.id))?.meta.aliases).toEqual(['L-9', 'L-9_old-name']);
    // The backup holds the pre-change copies, at their brain-relative paths.
    for (const note of [empty, close, lesson]) {
      expect(await readFile(join(result.backup, relative(brainPath(loc), note.path)), 'utf8')).toBe(store.encodeNote(note));
    }
    // A second apply of the same plan changes nothing and says why.
    const again = await applyTidy(brain, loc, (await loadTidyPlan(loc))!, { now: NOW });
    expect(again).toMatchObject({ sessions: 0, hypotheses: 0, aliases: 0 });
    expect(again.skipped.map(s => s.reason)).toEqual(['not found in this brain', 'hypothesis is already no-evidence']);
  });

  it('restricts --apply to the chosen kinds and refuses a plan made for another brain', async () => {
    const { loc, brain } = await setup();
    const empty = await seed(loc, { tier: 'episodic', kind: 'session', status: 'open-session', title: 'Claude Code session dddd4444' });
    const stale = await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', band: 'inferred', title: 'Stale' }, 'Old.');
    const plan = await planTidy(brain, loc, { now: NOW });
    const result = await applyTidy(brain, loc, plan, { only: ['hypotheses'], now: NOW });
    expect(result).toMatchObject({ sessions: 0, hypotheses: 1 });
    expect(await brain.read(empty.meta.id)).toBeDefined();
    expect((await brain.read(stale.meta.id))?.meta.status).toBe('no-evidence');
    const other = await setup();
    await expect(applyTidy(other.brain, other.loc, plan)).rejects.toThrow(/was made for/);
  });

  it('discardEmptySession never deletes a session with content or a closed one', async () => {
    const { loc, brain } = await setup();
    const full = await seed(loc, { tier: 'episodic', kind: 'session', status: 'open-session', title: 'Has notes' }, 'Work.');
    const closed = await seed(loc, { tier: 'episodic', kind: 'session', status: 'closed', title: 'Done' });
    const hypothesis = await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', title: 'Not a session' });
    for (const note of [full, closed, hypothesis]) {
      expect(await brain.discardEmptySession(note.meta.id)).toBe(false);
      expect(await brain.read(note.meta.id)).toBeDefined();
    }
  });
});
