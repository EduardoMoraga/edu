import { describe, expect, it } from 'vitest';
import { CORPUS_NOTES, CORPUS_QUERIES, QUERY_CLASSES } from './fixtures/corpus.js';
import { parseCorpus, percentile, rankMetrics, runRetrievalBench } from './retrieval.js';

describe('bench metric math', () => {
  it('computes recall@k and MRR on a hand-made case', () => {
    // ranks: hit at 1, hit at 2, hit at 6, miss
    const m = rankMetrics([1, 2, 6, null]);
    expect(m).toEqual({ n: 4, recallAt1: 0.25, recallAt5: 0.5, recallAt10: 0.75, mrr: Math.round(((1 + 0.5 + 1 / 6 + 0) / 4) * 1e4) / 1e4 });
    expect(rankMetrics([])).toEqual({ n: 0, recallAt1: 0, recallAt5: 0, recallAt10: 0, mrr: 0 });
    expect(rankMetrics([null, null]).mrr).toBe(0);
  });

  it('uses nearest-rank percentiles', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('bench corpus', () => {
  it('is bilingual, sized like a small brain and labels every class', () => {
    expect(CORPUS_NOTES.length).toBeGreaterThanOrEqual(110);
    expect(new Set(CORPUS_NOTES.map(n => n.key)).size).toBe(CORPUS_NOTES.length);
    expect(CORPUS_NOTES.filter(n => n.lang === 'es').length).toBeGreaterThan(30);
    expect(CORPUS_NOTES.filter(n => n.lang === 'en').length).toBeGreaterThan(30);
    const keys = new Set(CORPUS_NOTES.map(n => n.key));
    for (const query of CORPUS_QUERIES) expect(keys.has(query.expect)).toBe(true);
    for (const cls of QUERY_CLASSES) expect(CORPUS_QUERIES.filter(q => q.class === cls).length).toBeGreaterThanOrEqual(10);
  });
});

describe('retrieval bench', () => {
  it('is deterministic: two runs give the same ranks and metrics', async () => {
    const [a, b] = await Promise.all([runRetrievalBench(), runRetrievalBench()]);
    expect(a.overall).toEqual(b.overall);
    expect(a.byClass).toEqual(b.byClass);
    expect(a.queries.map(q => [q.id, q.rank, q.top3])).toEqual(b.queries.map(q => [q.id, q.rank, q.top3]));
    expect(a.corpus.queries).toBe(CORPUS_QUERIES.length);
    // Exact ids and aliases always resolve to the named note.
    expect(a.byClass.id.recallAt1).toBe(1);
    expect(a.latencyMs.p95).toBeGreaterThanOrEqual(a.latencyMs.p50);
  }, 30_000);
});

describe('custom corpus parsing', () => {
  const note = { key: 'a', title: 'A note', body: 'Body', tier: 'transitive', kind: 'decision' };
  it('maps q/target/class to fixture queries and keeps optional note fields', () => {
    const corpus = parseCorpus({ version: 3, notes: [{ ...note, status: 'active', tags: ['x'] }], queries: [{ q: 'note', target: 'a', class: 'my-class' }] });
    expect(corpus.version).toBe(3);
    expect(corpus.notes[0]).toEqual({ ...note, status: 'active', tags: ['x'] });
    expect(corpus.queries).toEqual([{ id: 'q1', class: 'my-class', text: 'note', expect: 'a' }]);
  });
  it('names the offending field', () => {
    expect(() => parseCorpus({ notes: [note], queries: [{ q: 'x', target: 'b', class: 'c' }] })).toThrow(/queries\[0\]\.target "b" is not a note key/);
    expect(() => parseCorpus({ notes: [{ ...note, tier: 'nope' }], queries: [{ q: 'x', target: 'a', class: 'c' }] })).toThrow(/notes\[0\]\.tier/);
    expect(() => parseCorpus({ notes: [note, note], queries: [{ q: 'x', target: 'a', class: 'c' }] })).toThrow(/duplicated/);
    expect(() => parseCorpus({ notes: [note], queries: [] })).toThrow(/queries/);
    expect(() => parseCorpus(null)).toThrow(/JSON object/);
  });
});
