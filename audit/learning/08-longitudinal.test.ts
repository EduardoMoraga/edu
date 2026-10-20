import { test, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openBrain } from '../../src/brain/brain.js';
import { brief } from '../../src/context/brief.js';
import { buildContext } from '../../src/context/pack.js';
import { estimateTokens } from '../../src/context/tokens.js';

test('three episodes with external outcomes, reversal and maintenance loss', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const root = await mkdtemp(join(tmpdir(), '08-longitudinal-'));
  const loc = { scope: 'project' as const, root };
  const brain = openBrain([loc]);
  // No init/setup: write only the minimal fixture identity; all brain writes stay in root.
  await writeFile(join(root, 'EDU.md'), '# Fixture identity\nTemporary audit only.');
  const opts = { eduMdPath: join(root, 'EDU.md'), trackUsage: false };
  const results: any = { harness: 'Cloudroom/pi; deterministic Vitest, no model calls', modelEnv: process.env.PI_MODEL ?? 'unknown', root, external: [], snapshots: [] };
  // Predeclared oracle facts: label-only 'normalization' is not an instruction to trim.
  const factPatterns = [/TRIM_SKU|trim surrounding whitespace/, /SCOPE_USER|cache isolated per user/];
  const snapshot = async (stage: string) => {
    const pack = await buildContext(brain, { query: 'checkout cache sku', budgetTokens: 1500 }, opts);
    const small = await buildContext(brain, { query: 'checkout cache sku', budgetTokens: 120 }, opts);
    const initial = await brief(brain, 1500, opts);
    const hits = await brain.recall('checkout cache sku', { limit: 20 });
    const bodies = hits.map(h => h.note.body).join('\n');
    const score = (text: string) => {
      const useful = factPatterns.flatMap((p, i) => p.test(text) ? [i === 0 ? 'TRIM_SKU' : 'SCOPE_USER'] : []);
      const lines = text.split('\n');
      const usefulLines = lines.filter(l => factPatterns.some(p => p.test(l))).join('\n');
      const noiseLines = lines.filter(l => /NOISE_/.test(l)).join('\n');
      return { useful, missingOf2: 2 - useful.length, obsolete: /SCOPE_GLOBAL|cache shared for throughput/.test(text), lines: lines.length, tokensEstimate: estimateTokens(text), usefulLineTokens: estimateTokens(usefulLines), knownNoiseTokens: estimateTokens(noiseLines) };
    };
    // Mechanical exact-fact adapter, NOT an LLM: tests whether the selected brief
    // contains enough explicit instructions for this fixed fixture.
    const trim = factPatterns[0].test(initial);
    const scope = factPatterns[1].test(initial) ? 'user' : 'global';
    const replay = {
      sku: run({ mode: 'sku', trim, scope, sku: ' SKU42 ', sourceContext: stage }),
      isolation: run({ mode: 'isolation', trim, scope, sku: 'SKU42', sourceContext: stage }),
    };
    results.snapshots.push({ stage, scriptedReplay: replay, context: pack.text, contextMetrics: score(pack.text), brief: initial, briefMetrics: score(initial), recallMetrics: score(bodies), recall: hits.map(h => ({ id: h.note.meta.id, status: h.note.meta.status, body: h.note.body, score: h.score })), small: { text: small.text, metrics: score(small.text), deferred: small.deferred } });
  };
  const run = (cfg: object) => {
    const child = spawnSync(process.execPath, ['audit/learning/08-fixture.mjs', JSON.stringify(cfg)], { encoding: 'utf8' });
    expect(child.error).toBeUndefined();
    const outcome = { exit: child.status, ...JSON.parse(child.stdout) };
    results.external.push(outcome);
    return outcome.ok;
  };
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  await snapshot('baseline');
  const e1 = await brain.openSession('checkout episode 1 normalization', 'audit:08');
  expect(run({ mode: 'sku', trim: false, sku: ' SKU42 ' })).toBe(false);
  const good = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'checkout sku trim surrounding whitespace', body: 'TRIM_SKU: trim surrounding whitespace before checkout lookup.', links: [e1.meta.id], source: 'audit:08' });
  for (const sku of [' SKU42', 'SKU42 ', ' SKU42 ']) {
    const ok = run({ mode: 'sku', trim: true, sku });
    expect(ok).toBe(true);
    await brain.feedback(good.meta.id, ok);
  }
  const old = await brain.write({ tier: 'transitive', kind: 'decision', title: 'checkout cache shared for throughput', body: 'SCOPE_GLOBAL: cache checkout results by sku only.', source: 'audit:08' });
  const bad = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'checkout cache optimization', body: 'SCOPE_GLOBAL: use a shared cache keyed only by sku.', source: 'audit:08' });
  await brain.write({ tier: 'transitive', kind: 'lesson', title: 'NOISE_1 gardening water orchids weekly', body: 'Unrelated gardening advice.', source: 'audit:08' });
  await brain.write({ tier: 'transitive', kind: 'lesson', title: 'NOISE_2 typography prefer serif headings', body: 'Unrelated typography advice.', source: 'audit:08' });
  await brain.closeSession(e1.meta.id, 'Normalization checks: three pass after trimming.\nTRIM_SKU validated with whitespace cases.');
  await snapshot('episode1');

  vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
  const e2 = await brain.openSession('checkout episode 2 isolation failure', 'audit:08');
  for (const sku of ['SKU42', 'SKU43', 'SKU44']) {
    const ok = run({ mode: 'isolation', scope: 'global', sku, trim: true });
    expect(ok).toBe(false);
    await brain.feedback(bad.meta.id, ok);
  }
  await brain.closeSession(e2.meta.id, 'Isolation failed in three independent sku cases.\nSCOPE_GLOBAL leaks private results across users.');
  await snapshot('episode2');

  vi.setSystemTime(new Date('2026-01-03T12:00:00Z'));
  const e3 = await brain.openSession('checkout episode 3 isolation correction', 'audit:08');
  const current = await brain.write({ tier: 'transitive', kind: 'decision', title: 'checkout cache isolated per user', body: 'SCOPE_USER: cache key must include user and normalized sku.', supersedes: old.meta.id, links: [e2.meta.id], source: 'audit:08' });
  for (const sku of ['SKU42', 'SKU43', 'SKU44']) expect(run({ mode: 'isolation', scope: 'user', sku, trim: true })).toBe(true);
  await brain.closeSession(e3.meta.id, 'User-scoped cache passed three isolation checks.\nSCOPE_USER includes user in cache key.');
  await snapshot('episode3-before-maintain');
  expect((await brain.read(old.meta.id))?.meta.status).toBe('reverted');
  expect((await brain.read(current.meta.id))?.meta.status).toBe('active');
  const closedBefore = await readFile(e3.path, 'utf8');
  results.maintenance = await brain.maintain();
  expect((await brain.read(good.meta.id))?.meta.status).toBe('proven');
  expect((await brain.read(bad.meta.id))?.meta.status).toBe('retired');
  await snapshot('after-maintain');
  expect(await readFile(e3.path, 'utf8')).toBe(closedBefore);
  results.notesAfterMaintain = (await brain.list()).map(n => n.meta);

  // Explicit long inactivity. All prior recall use timestamps are on Jan 1-3.
  vi.setSystemTime(new Date('2026-08-01T12:00:00Z'));
  results.lateMaintenance = await brain.maintain();
  await snapshot('after-210-days');
  expect((await brain.read(good.meta.id))?.meta.status).toBe('retired');
  results.notesFinal = (await brain.list()).map(n => n.meta);
  const snap = (stage: string) => results.snapshots.find((s: any) => s.stage === stage);
  expect(snap('episode3-before-maintain').briefMetrics.useful).toEqual(['TRIM_SKU', 'SCOPE_USER']);
  expect(snap('after-maintain').briefMetrics.useful).toEqual(['TRIM_SKU', 'SCOPE_USER']);
  expect(snap('after-210-days').briefMetrics.useful).toEqual(['SCOPE_USER']);
  expect(snap('after-210-days').recallMetrics.useful).toEqual(['TRIM_SKU', 'SCOPE_USER']);
  expect(snap('after-210-days').recallMetrics.obsolete).toBe(true);
  expect(snap('baseline').scriptedReplay).toEqual({ sku: false, isolation: false });
  expect(snap('after-maintain').scriptedReplay).toEqual({ sku: true, isolation: true });
  expect(snap('after-210-days').scriptedReplay).toEqual({ sku: false, isolation: true });
  expect(snap('after-maintain').contextMetrics.knownNoiseTokens).toBeGreaterThan(0);
  expect((await brain.read(good.meta.id))?.body).toContain('TRIM_SKU');
  for (const s of results.snapshots) expect(s.small.metrics.tokensEstimate).toBeLessThanOrEqual(120);
  // Reopening ensures this is persisted state, not an in-memory artifact.
  const reopened = openBrain([loc]);
  results.reopenedBrief = await brief(reopened, 1500, opts);
  expect(results.reopenedBrief).toBe(results.snapshots.at(-1).brief);
  await writeFile('audit/learning/08-results.json', JSON.stringify(results, null, 2) + '\n');
  vi.useRealTimers();
});
