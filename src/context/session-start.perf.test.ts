import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain, rankNotes } from '../brain/index.js';
import { noteCacheStats, resetNoteCache } from '../brain/store.js';
import { ALBERT_COUNTS, writeSyntheticBrain } from '../test-support/synthetic-brain.js';
import { brief } from './brief.js';
import { buildContext } from './pack.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const NOW = new Date('2026-10-08T00:00:00Z');

async function albertBrain() {
  const root = await mkdtemp(join(tmpdir(), 'edu-session-start-'));
  roots.push(root);
  const total = writeSyntheticBrain(root);
  return { root, total, brain: openBrain([{ scope: 'project' as const, root }]), eduMdPath: join(root, 'EDU.md') };
}

describe('session-start brief on a large imported brain', () => {
  it('stays byte-identical across consecutive read-only briefs and recall', async () => {
    const { brain, eduMdPath, total } = await albertBrain();
    expect(total).toBe(Object.values(ALBERT_COUNTS).reduce((sum, n) => sum + n, 0));
    const first = await brief(brain, 1500, { eduMdPath, now: NOW });
    // Read-only briefs must not change the ranking of subsequent calls.
    const second = await brief(brain, 1500, { eduMdPath, now: NOW });
    // A larger budget reaches more body passages without recording usage.
    const wide = await brief(brain, 6000, { eduMdPath, now: NOW });
    const wideAgain = await brief(brain, 6000, { eduMdPath, now: NOW });
    expect(second).toBe(first);
    expect(wideAgain).toBe(wide);
    const query = await buildContext(brain, { query: 'pricing forecast', budgetTokens: 800 }, { eduMdPath, now: NOW, trackUsage: false });
    const recall = rankNotes('stock latency review', await brain.list(), NOW, 12).map(hit => `${hit.note.meta.id} ${hit.score.toFixed(9)} ${hit.why}`);
    await expect([first, '=== second ===', second, '=== wide ===', wide, '=== wide again ===', wideAgain, '=== query ===', query.text, `deferred ${query.deferred.join(',')}`, '=== recall ===', ...recall].join('\n'))
      .toMatchFileSnapshot('./__snapshots__/session-start-brief.txt');
  }, 120_000);

  it('builds the brief in well under the 5 s Pi budget and reads each note file once', async () => {
    const { brain, eduMdPath, total } = await albertBrain();
    const { store } = await import('../brain/store.js').then(module => ({ store: module }));
    resetNoteCache();
    const started = performance.now();
    const text = await brief(brain, 1500, { eduMdPath, now: NOW });
    const elapsed = performance.now() - started;
    expect(text).toContain('## Active commitments & open hypotheses');
    expect(elapsed).toBeLessThan(3000);
    expect(noteCacheStats().parses).toBe(total);
  });
});
