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
    await brain.write({ tier: 'episodic', title: 'Release episode', body: 'A release happened.', created: '2026-10-07T00:00:00Z' });
    const pack = await buildContext(brain, { query: 'release', budgetTokens: 600 }, { eduMdPath });
    const titles = pack.sections.map(section => section.title);
    expect(titles.indexOf('Proven lessons')).toBeLessThan(titles.indexOf('Canonical hits'));
    expect(pack.text.indexOf('Verify release')).toBeLessThan(pack.text.indexOf('Plan release'));
    expect(pack.text).toContain('Release episode');
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

  it('records usage for an injected session brief', async () => {
    const { brain, eduMdPath } = await fixture();
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Injected lesson', body: 'brief content' });
    const { brief } = await import('./brief.js');
    await brief(brain, 400, { eduMdPath });
    expect((await brain.read(note.meta.id))?.meta.usage?.uses).toBe(1);
  });
});
