import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrainLocation, EduEvent, Engine, EngineRunRequest, Note, NoteMeta } from '../core/contracts.js';
import { brainPath } from '../brain/location.js';
import * as store from '../brain/store.js';
import { openBrain } from '../brain/brain.js';
import { applyDream, planDream } from './dream.js';
import { dreamPlanPath, loadDreamPlan, parseDreamPlan, renderDreamPlan, saveDreamPlan, type DreamPlan } from './dream-plan.js';
import { dreamCronLine, installDreamSchedule } from './dream-schedule.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const NOW = new Date('2026-11-08T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString();

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'edu-dream-')); dirs.push(root);
  const loc: BrainLocation = { scope: 'project', root };
  const brain = openBrain([loc]);
  await brain.init(loc);
  return { loc, brain };
}

let counter = 0;
async function seed(loc: BrainLocation, meta: Partial<NoteMeta> & Pick<NoteMeta, 'title' | 'tier'>, body = ''): Promise<Note> {
  const id = meta.id ?? (meta.tier === 'episodic' ? `2026-11-0${(counter++ % 8) + 1}-${store.slugify(meta.title)}-${String(counter).padStart(8, '0')}` : store.createId({ tier: meta.tier, kind: meta.kind, title: meta.title }));
  const full: NoteMeta = { id, tags: [], links: [], created: daysAgo(5), updated: daysAgo(5), ...meta };
  const note: Note = { meta: full, body, path: store.notePath(brainPath(loc), full, new Date(full.created)) };
  await store.atomicWrite(note.path, store.encodeNote(note));
  return note;
}
const session = (loc: BrainLocation, title: string, source: string, body: string, extra: Partial<NoteMeta> = {}) =>
  seed(loc, { tier: 'episodic', kind: 'session', status: 'closed', title, source, ...extra }, body);

/** Sessions from three hosts that keep hitting flaky snapshot tests, plus notes for every other heuristic. */
async function fixture(loc: BrainLocation) {
  const s1 = await session(loc, 'Claude session one', 'claude', 'The flaky snapshot tests failed again in CI; reran twice.');
  const s2 = await session(loc, 'Pi session two', 'pi', 'Spent an hour on flaky snapshot tests before the release.');
  const s3 = await session(loc, 'Codex session three', 'codex', 'Flaky snapshot tests blocked the merge; skipped them.');
  await session(loc, 'Old session', 'claude', 'flaky snapshot tests long ago', { created: daysAgo(40), updated: daysAgo(40) });
  // Covered topic: a lesson already talks about the rename race.
  const covered = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Rename race on Windows' }, 'Retry the rename race with backoff.');
  const s4 = await session(loc, 'Claude session four', 'claude', `Hit the rename race again. See [[${covered.meta.id}]].`);
  const s5 = await session(loc, 'Pi session five', 'pi', 'The rename race showed up on the build box.', { links: [covered.meta.id] });
  await session(loc, 'Codex session six', 'codex', 'Another rename race on Windows.');
  const stale = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Old forgotten idea', created: daysAgo(200), updated: NOW.toISOString() }, 'Nobody used this.');
  await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Old but used', created: daysAgo(200), usage: { uses: 4, wins: 0, losses: 0, lastUsed: daysAgo(3) } }, 'Still injected.');
  const target = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Retry renames on Windows' }, 'Back off and retry.');
  const linker = await seed(loc, { tier: 'transitive', kind: 'hypothesis', status: 'open', title: 'Linker', links: [target.meta.id] }, 'See [[retry-renames-on-windws]].');
  const pinned = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Pin the runtime', created: daysAgo(150), links: [target.meta.id] }, 'We currently pin Node 22.19.');
  return { s1, s2, s3, s4, s5, covered, stale, target, linker, pinned };
}

const byKind = (plan: DreamPlan, kind: string) => plan.proposals.filter(p => p.kind === kind);

describe('edu dream (deterministic)', () => {
  it('proposes recurring topics with prevalence and evidence, promotions, archive and lint fixes; reads only', async () => {
    const { loc, brain } = await setup();
    const f = await fixture(loc);
    const before = (await brain.list()).length;
    const plan = await planDream(brain, loc, { now: NOW });
    expect(plan.sessions).toBe(6);
    expect(plan.hosts).toEqual({ claude: 2, codex: 2, pi: 2 });

    const lessons = byKind(plan, 'new-lesson');
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ title: 'Recurring: flaky snapshot tests', prevalence: 3, checked: true, origin: 'heuristic' });
    expect(lessons[0]!.evidence).toEqual([f.s1.meta.id, f.s2.meta.id, f.s3.meta.id].sort());

    expect(byKind(plan, 'promote-lesson')).toEqual([expect.objectContaining({ evidence: [f.covered.meta.id, f.s4.meta.id, f.s5.meta.id].sort((a, b) => a === f.covered.meta.id ? -1 : b === f.covered.meta.id ? 1 : a.localeCompare(b)), prevalence: 2, checked: false })]);
    expect(byKind(plan, 'archive').map(p => p.changes)).toEqual([[{ op: 'set-status', id: f.stale.meta.id, from: 'candidate', to: 'retired' }]]);
    expect(byKind(plan, 'fix-link').map(p => p.changes)).toEqual([[{ op: 'add-alias', id: f.target.meta.id, alias: 'retry-renames-on-windws' }]]);
    const asOf = byKind(plan, 'add-as-of');
    expect(asOf).toHaveLength(1);
    expect(asOf[0]).toMatchObject({ checked: false, evidence: [f.pinned.meta.id] });
    expect(asOf[0]!.changes[0]).toMatchObject({ op: 'write-decision', supersedes: f.pinned.meta.id, title: 'Pin the runtime (as of 2026-11-08)' });
    expect(plan.findings.map(finding => finding.kind)).toEqual(expect.arrayContaining(['missing-page', 'stale-claim']));
    expect((await brain.list()).length).toBe(before);
  });

  it('proposes supersede for contradicting decisions and merge for duplicate lessons', async () => {
    const { loc, brain } = await setup();
    const anchor = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Anchor' }, 'Linked from everything.');
    const older = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Deploy previews on every pull request', created: daysAgo(20), links: [anchor.meta.id] }, 'Deploy previews on every pull request so reviewers see the change.');
    const newer = await seed(loc, { tier: 'transitive', kind: 'decision', status: 'active', title: 'Deploy previews on pull requests', created: daysAgo(5), links: [anchor.meta.id] }, 'Never deploy previews on every pull request: they cost too much.');
    const keep = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Check the PATH first', created: daysAgo(9), links: [anchor.meta.id] }, 'When a CLI is missing, check PATH before reinstalling.');
    const drop = await seed(loc, { tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Look at PATH', created: daysAgo(2), links: [anchor.meta.id] }, 'When a CLI is missing, check PATH before reinstalling.');
    const plan = await planDream(brain, loc, { now: NOW });
    expect(byKind(plan, 'supersede')).toEqual([expect.objectContaining({ checked: false, evidence: [older.meta.id, newer.meta.id], changes: [expect.objectContaining({ op: 'write-decision', supersedes: older.meta.id, links: [newer.meta.id, older.meta.id] })] })]);
    expect(byKind(plan, 'merge-duplicates')).toEqual([expect.objectContaining({ checked: true, changes: [{ op: 'set-status', id: drop.meta.id, from: 'candidate', to: 'retired', superseded_by: keep.meta.id }] })]);
  });

  it('round-trips the plan file and applies only checked proposals, through the lifecycle, once', async () => {
    const { loc, brain } = await setup();
    const f = await fixture(loc);
    const plan = await planDream(brain, loc, { now: NOW });
    const path = await saveDreamPlan(loc, plan);
    expect(path).toBe(dreamPlanPath(loc));
    expect(parseDreamPlan(renderDreamPlan(plan))).toEqual(plan);

    // The reviewer unticks the new lesson and ticks the as-of fix.
    const newLesson = byKind(plan, 'new-lesson')[0]!.id, asOf = byKind(plan, 'add-as-of')[0]!.id, archive = byKind(plan, 'archive')[0]!.id;
    let text = await readFile(path, 'utf8');
    expect(text).toContain(`- [x] ${newLesson}`);
    text = text.replace(`- [x] ${newLesson}`, `- [ ] ${newLesson}`).replace(`- [ ] ${asOf}`, `- [x] ${asOf}`);
    await writeFile(path, text);

    const reviewed = (await loadDreamPlan(loc))!;
    const { result, plan: after } = await applyDream(brain, loc, reviewed, { now: NOW });
    expect(result.applied).toEqual(expect.arrayContaining([asOf, archive, byKind(plan, 'fix-link')[0]!.id]));
    expect(result.applied).not.toContain(newLesson);
    expect(result.applied).not.toContain(byKind(plan, 'promote-lesson')[0]!.id);
    expect(result.skipped).toEqual([]);

    expect(await brain.read('L-recurring-topic-flaky-snapshot-tests')).toBeUndefined();
    const archived = await brain.read(f.stale.meta.id);
    expect(archived?.meta.status).toBe('retired');
    await access(archived!.path);
    expect((await brain.read(f.target.meta.id))?.meta.aliases).toEqual(['retry-renames-on-windws']);
    expect((await brain.read(f.pinned.meta.id))?.meta.status).toBe('reverted');
    const successor = (await brain.list({ kind: 'decision', status: 'active' }))[0]!;
    expect(successor.meta).toMatchObject({ source: 'edu:dream', band: 'inferred', supersedes: f.pinned.meta.id });
    expect(successor.body).toContain('(as of 2026-11-08)');
    expect((await brain.read(f.covered.meta.id))?.meta.status).toBe('candidate');
    expect(await readdir(result.backup, { recursive: true })).toEqual(expect.arrayContaining([expect.stringContaining('old-forgotten-idea')]));

    // Applied proposals are marked and never run twice.
    await saveDreamPlan(loc, after);
    const again = await applyDream(brain, loc, (await loadDreamPlan(loc))!, { now: NOW });
    expect(again.result.applied).toEqual([]);
    expect(await readFile(path, 'utf8')).toContain(`(applied ${NOW.toISOString()})`);
  });

  it('refuses a plan made for another brain and skips proposals whose note changed since planning', async () => {
    const { loc, brain } = await setup();
    const f = await fixture(loc);
    const plan = await planDream(brain, loc, { now: NOW });
    await expect(applyDream(brain, loc, { ...plan, brain: '/elsewhere' })).rejects.toThrow(/made for/);
    await brain.update(f.stale.meta.id, { status: 'retired' });
    const { result } = await applyDream(brain, loc, plan, { now: NOW });
    expect(result.skipped).toEqual([{ id: byKind(plan, 'archive')[0]!.id, reason: `${f.stale.meta.id} is retired, not candidate` }]);
  });

  it('writes no new-lesson proposal for a topic in fewer than --min-sessions sessions', async () => {
    const { loc, brain } = await setup();
    await session(loc, 'One', 'claude', 'The flaky snapshot tests failed.');
    await session(loc, 'Two', 'pi', 'Flaky snapshot tests again.');
    expect(byKind(await planDream(brain, loc, { now: NOW }), 'new-lesson')).toEqual([]);
    expect(byKind(await planDream(brain, loc, { now: NOW, minSessions: 2 }), 'new-lesson')).toHaveLength(1);
  });
});

const fakeEngine = (reply: (prompt: string) => unknown, prompts: string[] = []): Engine => ({
  cli: 'claude', available: async () => true,
  async *run(request: EngineRunRequest, agentId: string): AsyncIterable<EduEvent> {
    prompts.push(request.prompt);
    yield { type: 'agent.text', agentId, text: JSON.stringify(reply(request.prompt)), at: new Date().toISOString() };
  },
});

describe('edu dream --model', () => {
  it('keeps model proposals that cite supplied evidence and drops the rest', async () => {
    const { loc, brain } = await setup();
    const f = await fixture(loc);
    const prompts: string[] = [];
    const engine = fakeEngine(() => ({ proposals: [
      { kind: 'new-lesson', title: 'Quarantine flaky snapshots', body: 'Move flaky snapshot tests to a quarantine job.', rationale: 'Three hosts lost time on them.', evidence: [f.s1.meta.id, f.s2.meta.id] },
      { kind: 'new-lesson', title: 'Invented', body: 'x', rationale: 'y', evidence: ['S-does-not-exist'] },
      { kind: 'archive', title: 'Archive covered', rationale: 'z', evidence: [f.s4.meta.id], targets: [f.target.meta.id] },
      { kind: 'teleport', title: 'bad' },
    ] }), prompts);
    const plan = await planDream(brain, loc, { now: NOW, engine });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(f.s1.meta.id);
    const model = plan.proposals.filter(p => p.origin === 'model');
    expect(model).toEqual([expect.objectContaining({ kind: 'new-lesson', title: 'Quarantine flaky snapshots', prevalence: 2, checked: true })]);
    expect(plan.model).toMatchObject({ cli: 'claude', proposed: 4 });
    expect(plan.model!.dropped).toHaveLength(3);
    expect(plan.model!.dropped.join('\n')).toContain('S-does-not-exist');
    expect(plan.proposals.filter(p => p.origin === 'heuristic').length).toBeGreaterThan(0);

    const reviewed = { ...plan, proposals: plan.proposals.map(p => ({ ...p, checked: p.origin === 'model' })) };
    const { result } = await applyDream(brain, loc, reviewed, { now: NOW });
    expect(result.written).toHaveLength(1);
    const lesson = await brain.read(result.written[0]!);
    expect(lesson?.meta).toMatchObject({ kind: 'lesson', status: 'candidate', band: 'inferred', source: 'edu:dream', links: [f.s1.meta.id, f.s2.meta.id].sort() });
  });

  it('validates evidence against what was supplied, not what exists', async () => {
    const { loc, brain } = await setup();
    const f = await fixture(loc);
    let supplied: string[] = [];
    const engine = fakeEngine(prompt => {
      supplied = JSON.parse(prompt.split('\n\n').find(part => part.startsWith('Sessions: '))!.slice('Sessions: '.length)).map((note: { id: string }) => note.id);
      const omitted = [f.s1, f.s2, f.s3, f.s4, f.s5].map(note => note.meta.id).find(id => !supplied.includes(id))!;
      return { proposals: [{ kind: 'new-lesson', title: 'Unseen', body: 'Unsupported', rationale: 'r', evidence: [omitted] }] };
    });
    const plan = await planDream(brain, loc, { now: NOW, engine, maxEpisodes: 1 });
    expect(supplied).toHaveLength(1);
    expect(plan.proposals.filter(p => p.origin === 'model')).toEqual([]);
    expect(plan.model!.dropped[0]).toMatch(/not in the supplied evidence/);
    expect(plan.model!.deferred).toBe(5);
  });

  it('rejects a reply that is not JSON', async () => {
    const { loc, brain } = await setup();
    await fixture(loc);
    const engine: Engine = { cli: 'claude', available: async () => true, async *run(_request, agentId) { yield { type: 'agent.text', agentId, text: 'not json', at: NOW.toISOString() }; } };
    await expect(planDream(brain, loc, { now: NOW, engine })).rejects.toThrow(/strict JSON/);
  });
});

describe('dream schedule', () => {
  it('writes a nightly systemd timer per project without calling the real service manager', async () => {
    const home = await mkdtemp(join(tmpdir(), 'edu-dream-home-')); dirs.push(home);
    const calls: string[][] = [];
    const result = await installDreamSchedule({ home, node: '/usr/bin/node', cli: '/opt/edu/cli.js', cwd: '/work/project', hour: 4, platform: 'linux', run: async (cmd, args) => { calls.push([cmd, ...args]); return 0; } });
    expect(result).toMatchObject({ kind: 'systemd', started: true });
    const timer = await readFile(result.files[1]!, 'utf8');
    expect(timer).toContain('OnCalendar=*-*-* 04:30:00');
    expect(await readFile(result.files[0]!, 'utf8')).toContain('--cwd "/work/project" dream');
    expect(calls.at(-1)).toEqual(['systemctl', '--user', 'enable', '--now', `${result.name}.timer`]);
    await expect(installDreamSchedule({ home, node: 'node', cli: 'cli.js', cwd: '/w', platform: 'win32', run: async () => 0 })).rejects.toThrow(/Schedule this command yourself/);
    expect(dreamCronLine({ node: 'node', cli: 'cli.js', cwd: '/w' })).toBe('30 3 * * * "node" "cli.js" --cwd "/w" dream');
  });
});
