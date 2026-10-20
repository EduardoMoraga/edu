import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { brief } from './brief.js';
import { buildContext } from './pack.js';
import { estimateTokens } from './tokens.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-context-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await brain.init(location);
  const eduMdPath = join(root, 'EDU.md');
  await writeFile(eduMdPath, '# Identity\nKeep promises.\n<!-- edu:extended -->\nHidden extended section.');
  return { root, brain, eduMdPath };
}

describe('context packs', () => {
  it('opens the identity core with the workspace agent name from config.json', async () => {
    const { root, brain, eduMdPath } = await fixture();
    await writeFile(join(root, 'config.json'), JSON.stringify({ identity: { name: 'Albert', role: 'Trade marketing analyst' } }));
    const text = await brief(brain, 400, { eduMdPath });
    expect(text).toContain("You are **Albert**, this workspace's agent, powered by Edu.");
    expect(text).toContain('Role: Trade marketing analyst');
    expect(text.indexOf('Albert')).toBeLessThan(text.indexOf('Keep promises.'));
  });

  it('prioritizes sections, tracks deferred notes, and never exceeds a small budget', async () => {
    const { brain, eduMdPath } = await fixture();
    const commitment = await brain.write({ tier: 'transitive', kind: 'commitment', title: 'Ship the release', body: 'release', due: '2026-10-09' });
    const hypothesis = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: 'Release helps', body: 'release', band: 'hypothesis' });
    const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Release carefully', body: 'release'.repeat(100) });
    for (let i = 0; i < 20; i++) await brain.write({ tier: 'transitive', kind: 'lesson', title: `Release candidate ${i}`, body: 'release'.repeat(30) });
    const pack = await buildContext(brain, { query: 'release', budgetTokens: 50 }, { eduMdPath, now: new Date('2026-10-08T00:00:00Z') });
    expect(pack.tokens).toBe(estimateTokens(pack.text));
    expect(pack.tokens).toBeLessThanOrEqual(50);
    expect(pack.sections[0]?.title).toBe('Identity core');
    expect(pack.text).toContain('Keep promises.');
    expect(pack.text).not.toContain('Hidden extended section.');
    expect(pack.text).toContain(commitment.meta.title);
    expect(pack.text).toContain(hypothesis.meta.title);
    expect(pack.deferred).toContain(lesson.meta.id);
    expect((await brain.read(lesson.meta.id))?.meta.usage?.uses ?? 0).toBe(0);
    expect((await brain.read(commitment.meta.id))?.meta.usage?.uses).toBe(1);
  });

  it('includes a proven lesson before a candidate, then canonical hits and episodes', async () => {
    const { brain, eduMdPath } = await fixture();
    await brain.write({ tier: 'transitive', kind: 'lesson', status: 'candidate', title: 'Plan release', body: 'release' });
    await brain.write({ tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Verify release', body: 'release' });
    const canonical = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: 'Release standard', body: 'First paragraph.\n\nLong details.'.repeat(100) });
    await brain.acceptCanonical(canonical.meta.id);
    const domain = await brain.proposeCanonical({ tier: 'canonical', kind: 'domain', title: 'Release domain', body: 'Release requires checksum V9.' });
    await brain.acceptCanonical(domain.meta.id);
    await brain.write({ tier: 'episodic', title: 'Release episode', body: 'A release happened.', created: '2026-10-07T00:00:00Z' });
    const pack = await buildContext(brain, { query: 'release', budgetTokens: 600 }, { eduMdPath });
    const titles = pack.sections.map(section => section.title);
    expect(titles.indexOf('Proven lessons')).toBeLessThan(titles.indexOf('Canonical hits'));
    expect(pack.text.indexOf('Verify release')).toBeLessThan(pack.text.indexOf('Plan release'));
    expect(pack.text).toContain('Release episode');
    expect(pack.text).toContain('checksum V9');
    expect(pack.sections.flatMap(section => section.noteIds).filter(id => id === canonical.meta.id)).toHaveLength(1);
  });

  it('makes a deterministic brief with only the last three episodes', async () => {
    const { brain, eduMdPath } = await fixture();
    for (let i = 1; i <= 4; i++) await brain.write({ tier: 'episodic', title: `Episode ${i}`, body: 'Summary', created: `2026-10-0${i}T00:00:00Z` });
    const opts = { eduMdPath, now: new Date('2026-10-08T00:00:00Z'), trackUsage: false };
    const first = await brief(brain, 1500, opts);
    expect(await brief(brain, 1500, opts)).toBe(first);
    expect(first).not.toContain('Episode 1');
    expect(first).toContain('Episode 4');
    expect(first).toContain('edu_recall/edu_read');
  });

  it('keeps weighted candidate ordering stable across repeated briefs', async () => {
    const { brain, eduMdPath } = await fixture();
    const stale = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Alpha weighted lesson', body: 'Old lesson' });
    await brain.update(stale.meta.id, { usage: { uses: 1, wins: 4, losses: 0, lastUsed: '2026-01-01T00:00:00Z' } });
    await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Beta fresh lesson', body: 'New lesson' });
    const opts = { eduMdPath, now: new Date('2026-10-08T00:00:00Z'), trackUsage: false };
    const first = await brief(brain, 1500, opts);
    const second = await brief(brain, 1500, opts);
    expect(first).toBe(second);
    expect(first.indexOf('Beta fresh lesson')).toBeLessThan(first.indexOf('Alpha weighted lesson'));
  });

  it('can preview a context pack without recording note usage', async () => {
    const { brain, eduMdPath } = await fixture();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Preview lesson', body: 'read only' });
    await buildContext(brain, { query: 'preview', budgetTokens: 200 }, { eduMdPath, trackUsage: false });
    expect((await brain.read(note.meta.id))?.meta.usage).toBeUndefined();
  });

  it('does not record usage merely by building a session brief', async () => {
    const { brain, eduMdPath } = await fixture();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Injected lesson', body: 'brief content' });
    const { brief } = await import('./brief.js');
    await brief(brain, 400, { eduMdPath });
    expect((await brain.read(note.meta.id))?.meta.usage).toBeUndefined();
  });
});

describe('brief essentials', () => {
  it('always includes accepted profile/preferences and active decisions', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { openBrain } = await import('../brain/index.js');
    const { brief } = await import('./brief.js');
    const root = await mkdtemp(join(tmpdir(), 'edu-brief-'));
    roots.push(root);
    const brain = openBrain([{ scope: 'project', root }]);
    await brain.init({ scope: 'project', root });
    const person = await brain.proposeCanonical({ title: 'Ada — perfil', body: 'Economist and data scientist.', tier: 'canonical', kind: 'person' });
    await brain.acceptCanonical(person.meta.id);
    await brain.write({ title: 'Cheil lives on another laptop', body: 'x', tier: 'transitive', kind: 'decision' });
    const text = await brief(brain, 1500);
    expect(text).toContain('Ada — perfil');
    expect(text).toContain('Economist and data scientist.');
    expect(text).toContain('Cheil lives on another laptop');
  });
});


describe('actionable budgeted context', () => {
  it('recovers an old decision body and excludes irrelevant candidates despite newer noise', async () => {
    const { brain, eduMdPath } = await fixture();
    const decision = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Payment policy', created: '2020-01-01', body: 'Introduction.\n\nCobros duplicados: keep Idempotency-Key for 72 horas.' });
    for (let i = 0; i < 10; i++) {
      await brain.write({ tier: 'transitive', kind: 'decision', title: `Icons ${i}`, body: 'Blue buttons' });
      await brain.write({ tier: 'transitive', kind: 'lesson', title: `Noise ${i}`, body: 'Purple shapes' });
      await brain.write({ tier: 'transitive', kind: 'commitment', title: `Unrelated pending work ${i}`, body: 'Icons' });
    }
    const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Recovery', body: 'Preface.\n\nCobros duplicados: wait 47 minutos.' });
    const pack = await buildContext(brain, { query: 'Cobros duplicados', budgetTokens: 800 }, { eduMdPath, trackUsage: false });
    expect(pack.text).toContain(decision.meta.id);
    expect(pack.text).toContain('active');
    expect(pack.text).toContain('72 horas');
    expect(pack.text).toContain(lesson.meta.id);
    expect(pack.text).toContain('candidate');
    expect(pack.text).toContain('47 minutos');
    expect(pack.text).not.toContain('Noise');
    expect(pack.text).not.toContain('Icons');
    const tiny = await buildContext(brain, { query: 'Cobros duplicados', budgetTokens: 10 }, { eduMdPath, trackUsage: false });
    expect(tiny.deferred).toEqual(expect.arrayContaining([decision.meta.id, lesson.meta.id]));
    expect(tiny.tokens).toBeLessThanOrEqual(10);
  });

  it('caps unqueried candidates and reports every excluded relevant note', async () => {
    const { brain, eduMdPath } = await fixture();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await brain.write({ tier: 'transitive', kind: 'lesson', title: `Release ${i}`, body: 'Use checksum V9.' })).meta.id);
    const pack = await buildContext(brain, { budgetTokens: 8000 }, { eduMdPath, trackUsage: false });
    const included = pack.sections.flatMap(section => section.noteIds);
    expect(included.length).toBeLessThanOrEqual(3);
    expect(included.length).toBeGreaterThan(0);
    expect(new Set([...included, ...pack.deferred])).toEqual(new Set(ids));
    const queried = await buildContext(brain, { query: 'release', budgetTokens: 130 }, { eduMdPath, trackUsage: false });
    expect(new Set([...queried.sections.flatMap(section => section.noteIds), ...queried.deferred])).toEqual(new Set(ids));
    expect(queried.tokens).toBe(estimateTokens(queried.text));
    expect(queried.tokens).toBeLessThanOrEqual(130);
  });

  it('reserves room for actionable rules under large identity and essentials', async () => {
    const { brain, eduMdPath } = await fixture();
    await writeFile(eduMdPath, '# Identity\nYou are Albert.\n' + 'Keep promises. '.repeat(1000));
    for (let i = 0; i < 10; i++) {
      const note = await brain.proposeCanonical({ tier: 'canonical', kind: 'preference', title: `Preference ${i}`, body: 'Prefer concise answers. '.repeat(100) });
      await brain.acceptCanonical(note.meta.id);
    }
    const decision = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Payments', body: 'Idempotency-Key expires after 72 hours.' });
    const pack = await buildContext(brain, { query: 'Payments', budgetTokens: 400 }, { eduMdPath, trackUsage: false });
    expect(pack.text).toContain('You are Albert.');
    expect(pack.text).toContain(decision.meta.id);
    expect(pack.text).toContain('72 hours');
    expect(pack.text).toContain('Prefer concise answers.');
    expect(pack.tokens).toBeLessThanOrEqual(400);
    expect(pack.deferred.length).toBeGreaterThan(0);
  });
});


it('finds a useful passage deep in a body and defers all relevant notes at zero budget', async () => {
  const { brain, eduMdPath } = await fixture();
  const note = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Recovery policy', body: 'Background context. '.repeat(300) + 'Snapshot Q7 must wait 47 minutes before restore.' });
  const pack = await buildContext(brain, { query: 'snapshot Q7', budgetTokens: 250 }, { eduMdPath, trackUsage: false });
  expect(pack.text).toContain('47 minutes');
  expect(pack.text).toContain(note.meta.id);
  const empty = await buildContext(brain, { query: 'snapshot Q7', budgetTokens: 0 }, { eduMdPath, trackUsage: false });
  expect(empty.text).toBe('');
  expect(empty.tokens).toBe(0);
  expect(empty.deferred).toEqual([note.meta.id]);
  const irrelevant = await buildContext(brain, { query: 'zebras', budgetTokens: 800 }, { eduMdPath, trackUsage: false });
  expect(irrelevant.text).not.toContain(note.meta.id);
  expect(irrelevant.deferred).not.toContain(note.meta.id);
});

it('preserves explicit usage tracking for callers that inject a brief', async () => {
  const { brain, eduMdPath } = await fixture();
  const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Explicit injection', body: 'Check the checksum.' });
  await brief(brain, 400, { eduMdPath, trackUsage: true });
  expect((await brain.read(note.meta.id))?.meta.usage?.uses).toBe(1);
});
