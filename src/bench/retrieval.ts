/**
 * `edu bench retrieval`: recall quality of the brain on a deterministic bilingual corpus.
 *
 * Retrieval goes through `brain.recall(query, { limit: 10 })`, the same call the `edu_recall` MCP tool makes.
 * `recall` records exposure on the notes it returns (a write), and exposure feeds the learned weight, so every
 * query runs against a fresh copy of the seeded brain: results never depend on query order or on earlier runs,
 * and the measured latency includes the exposure write a real recall pays.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBrain } from '../brain/index.js';
import type { BrainLocation } from '../core/contracts.js';
import { CORPUS_NOTES, CORPUS_QUERIES, CORPUS_VERSION, QUERY_CLASSES, fixtureCreated, type FixtureNote, type FixtureQuery, type QueryClass } from './fixtures/corpus.js';

export interface RankMetrics {
  n: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
}

export interface QueryResult {
  id: string;
  class: QueryClass;
  query: string;
  /** Fixture key of the expected note (note ids of sessions carry a random suffix, keys do not). */
  expected: string;
  /** 1-based rank of the expected note in the top 10, or null when it was not returned. */
  rank: number | null;
  /** Fixture keys of the first three hits. */
  top3: string[];
  latencyMs: number;
}

export interface RetrievalReport {
  corpus: { version: number; notes: number; queries: number; byLang: Record<'es' | 'en', number> };
  overall: RankMetrics;
  byClass: Record<QueryClass, RankMetrics>;
  latencyMs: { p50: number; p95: number };
  queries: QueryResult[];
}

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** recall@1/5/10 and MRR (reciprocal rank, 0 when missing) over 1-based ranks. */
export function rankMetrics(ranks: ReadonlyArray<number | null>): RankMetrics {
  const n = ranks.length;
  if (!n) return { n: 0, recallAt1: 0, recallAt5: 0, recallAt10: 0, mrr: 0 };
  const within = (k: number) => ranks.filter(rank => rank !== null && rank <= k).length / n;
  const mrr = ranks.reduce<number>((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / n;
  return { n, recallAt1: round(within(1)), recallAt5: round(within(5)), recallAt10: round(within(10)), mrr: round(mrr) };
}

/** Nearest-rank percentile (p in 0..100) of a sample; 0 for an empty sample. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

/** Writes the fixture corpus into `root` (an Edu root, e.g. `<project>/.edu`) through the public Brain API; returns fixture key → note id. */
export async function seedCorpus(root: string, notes: readonly FixtureNote[] = CORPUS_NOTES): Promise<Map<string, string>> {
  const location: BrainLocation = { scope: 'project', root };
  const brain = openBrain([location]);
  await brain.init(location);
  const ids = new Map<string, string>();
  for (const [index, fixture] of notes.entries()) {
    const created = fixtureCreated(index);
    const provenance = {
      ...(fixture.legacyId ? { legacy_id: fixture.legacyId } : {}),
      ...(fixture.aliases ? { aliases: fixture.aliases } : {}),
    };
    const base = { title: fixture.title, body: fixture.body, tier: fixture.tier, kind: fixture.kind, created, source: 'bench:fixture', provenance, ...(fixture.tags ? { tags: fixture.tags } : {}) };
    if (fixture.tier === 'canonical') {
      const proposed = await brain.proposeCanonical(base);
      ids.set(fixture.key, (await brain.acceptCanonical(proposed.meta.id)).meta.id);
    } else if (fixture.kind === 'session') {
      ids.set(fixture.key, (await brain.write({ ...base, status: 'closed' })).meta.id);
    } else {
      ids.set(fixture.key, (await brain.write({ ...base, ...(fixture.due ? { due: fixture.due } : {}) })).meta.id);
    }
  }
  return ids;
}

export interface RetrievalOptions {
  /** Parent folder for the temporary brains (defaults to the OS temp dir). Removed afterwards. */
  tmpRoot?: string;
  queries?: readonly FixtureQuery[];
  notes?: readonly FixtureNote[];
}

export async function runRetrievalBench(options: RetrievalOptions = {}): Promise<RetrievalReport> {
  const notes = options.notes ?? CORPUS_NOTES;
  const queries = options.queries ?? CORPUS_QUERIES;
  const base = await mkdtemp(join(options.tmpRoot ?? tmpdir(), 'edu-bench-retrieval-'));
  try {
    const template = join(base, 'template', '.edu');
    const ids = await seedCorpus(template, notes);
    const keys = new Map([...ids].map(([key, id]) => [id, key]));
    const results: QueryResult[] = [];
    for (const [index, query] of queries.entries()) {
      const expected = ids.get(query.expect);
      if (!expected) throw new Error(`Bench query ${query.id} expects unknown fixture ${query.expect}`);
      const text = query.text === '@id' ? expected : query.text;
      const root = join(base, `q${index}`, '.edu');
      await cp(template, root, { recursive: true });
      const brain = openBrain([{ scope: 'project', root }]);
      const started = performance.now();
      const hits = await brain.recall(text, { limit: 10 });
      const latencyMs = performance.now() - started;
      await rm(join(base, `q${index}`), { recursive: true, force: true });
      const position = hits.findIndex(hit => hit.note.meta.id === expected);
      const top3 = hits.slice(0, 3).map(hit => keys.get(hit.note.meta.id) ?? hit.note.meta.id);
      results.push({ id: query.id, class: query.class, query: query.text, expected: query.expect, rank: position >= 0 ? position + 1 : null, top3, latencyMs: round(latencyMs, 2) });
    }
    const byClass = Object.fromEntries(QUERY_CLASSES.map(cls => [cls, rankMetrics(results.filter(r => r.class === cls).map(r => r.rank))])) as Record<QueryClass, RankMetrics>;
    const latencies = results.map(r => r.latencyMs);
    return {
      corpus: { version: CORPUS_VERSION, notes: notes.length, queries: queries.length, byLang: { es: notes.filter(n => n.lang === 'es').length, en: notes.filter(n => n.lang === 'en').length } },
      overall: rankMetrics(results.map(r => r.rank)),
      byClass,
      latencyMs: { p50: round(percentile(latencies, 50), 2), p95: round(percentile(latencies, 95), 2) },
      queries: results,
    };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
