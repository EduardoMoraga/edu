/**
 * `edu bench retrieval`: recall quality of the brain on a deterministic bilingual corpus.
 *
 * Retrieval goes through `brain.recall(query, { limit: 10 })`, the same call the `edu_recall` MCP tool makes.
 * `recall` records exposure on the notes it returns (a write), and exposure feeds the learned weight, so every
 * query runs against a fresh copy of the seeded brain: results never depend on query order or on earlier runs,
 * and the measured latency includes the exposure write a real recall pays.
 */
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBrain } from '../brain/index.js';
import type { BrainLocation, NoteMeta } from '../core/contracts.js';
import { CORPUS_NOTES, CORPUS_QUERIES, CORPUS_VERSION, fixtureCreated, type FixtureNote, type FixtureQuery } from './fixtures/corpus.js';

export interface RankMetrics {
  n: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
}

export interface QueryResult {
  id: string;
  /** Query class: the built-in corpus uses keyword | paraphrase | cross-language | id; a custom corpus any name. */
  class: string;
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
  /** `source` is `builtin` or the path of a `--corpus` file; a custom corpus has version 0 unless it declares one. */
  corpus: { source: string; version: number; notes: number; queries: number; byLang: Record<'es' | 'en', number> };
  overall: RankMetrics;
  /** Metrics per query class, in order of first appearance. */
  byClass: Record<string, RankMetrics>;
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
      ids.set(fixture.key, fixture.status === 'proposed' ? proposed.meta.id : (await brain.acceptCanonical(proposed.meta.id)).meta.id);
    } else if (fixture.kind === 'session') {
      ids.set(fixture.key, (await brain.write({ ...base, status: fixture.status ?? 'closed' })).meta.id);
    } else {
      ids.set(fixture.key, (await brain.write({ ...base, ...(fixture.due ? { due: fixture.due } : {}), ...(fixture.status ? { status: fixture.status } : {}) })).meta.id);
    }
  }
  return ids;
}

export interface RetrievalOptions {
  /** Parent folder for the temporary brains (defaults to the OS temp dir). Removed afterwards. */
  tmpRoot?: string;
  queries?: readonly FixtureQuery[];
  notes?: readonly FixtureNote[];
  /** Reported corpus source and version (defaults: `builtin`, the built-in CORPUS_VERSION). */
  source?: string;
  version?: number;
}

export interface CustomCorpus { version: number; notes: FixtureNote[]; queries: FixtureQuery[] }

const TIERS = new Set(['canonical', 'episodic', 'transitive']);
const KINDS = new Set(['decision', 'hypothesis', 'commitment', 'lesson', 'identity', 'standard', 'lexicon', 'domain', 'person', 'preference', 'session']);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Validates a `--corpus` JSON document: `{ version?, notes: [{ key, title, body, tier, kind, status?, tags?, due?,
 * lang?, legacyId?, aliases? }], queries: [{ q, target, class, id? }] }`. Class names are free-form.
 */
export function parseCorpus(raw: unknown): CustomCorpus {
  const fail = (message: string): never => { throw new Error(`Invalid corpus: ${message}`); };
  if (!raw || typeof raw !== 'object') fail('expected a JSON object with notes and queries');
  const { notes, queries, version } = raw as Record<string, unknown>;
  if (!Array.isArray(notes) || !notes.length) fail('"notes" must be a non-empty array');
  if (!Array.isArray(queries) || !queries.length) fail('"queries" must be a non-empty array');
  if (version !== undefined && typeof version !== 'number') fail('"version" must be a number');
  const keys = new Set<string>();
  const parsedNotes = (notes as unknown[]).map((entry, index): FixtureNote => {
    const n = (entry ?? {}) as Record<string, unknown>;
    const where = `notes[${index}]`;
    if (!isText(n.key)) fail(`${where}.key must be a non-empty string`);
    if (keys.has(n.key as string)) fail(`${where}.key "${String(n.key)}" is duplicated`);
    keys.add(n.key as string);
    if (!isText(n.title)) fail(`${where}.title must be a non-empty string`);
    if (typeof n.body !== 'string') fail(`${where}.body must be a string`);
    if (!TIERS.has(n.tier as string)) fail(`${where}.tier must be one of ${[...TIERS].join(', ')}`);
    if (!KINDS.has(n.kind as string)) fail(`${where}.kind must be one of ${[...KINDS].join(', ')}`);
    if (n.tags !== undefined && (!Array.isArray(n.tags) || !n.tags.every(isText))) fail(`${where}.tags must be an array of strings`);
    if (n.aliases !== undefined && (!Array.isArray(n.aliases) || !n.aliases.every(isText))) fail(`${where}.aliases must be an array of strings`);
    for (const field of ['status', 'due', 'legacyId'] as const) if (n[field] !== undefined && !isText(n[field])) fail(`${where}.${field} must be a string`);
    if (n.lang !== undefined && n.lang !== 'es' && n.lang !== 'en') fail(`${where}.lang must be es or en`);
    return {
      key: n.key as string, title: n.title as string, body: n.body as string,
      tier: n.tier as FixtureNote['tier'], kind: n.kind as FixtureNote['kind'],
      ...(n.lang ? { lang: n.lang as 'es' | 'en' } : {}),
      ...(n.status ? { status: n.status as NoteMeta['status'] } : {}),
      ...(n.tags ? { tags: n.tags as string[] } : {}),
      ...(n.due ? { due: n.due as string } : {}),
      ...(n.legacyId ? { legacyId: n.legacyId as string } : {}),
      ...(n.aliases ? { aliases: n.aliases as string[] } : {}),
    };
  });
  const parsedQueries = (queries as unknown[]).map((entry, index): FixtureQuery => {
    const q = (entry ?? {}) as Record<string, unknown>;
    const where = `queries[${index}]`;
    if (!isText(q.q)) fail(`${where}.q must be a non-empty string`);
    if (!isText(q.target)) fail(`${where}.target must be a non-empty string`);
    if (!keys.has(q.target as string)) fail(`${where}.target "${String(q.target)}" is not a note key`);
    if (!isText(q.class)) fail(`${where}.class must be a non-empty string`);
    if (q.id !== undefined && !isText(q.id)) fail(`${where}.id must be a string`);
    return { id: (q.id as string | undefined) ?? `q${index + 1}`, class: q.class as string, text: q.q as string, expect: q.target as string };
  });
  return { version: (version as number | undefined) ?? 0, notes: parsedNotes, queries: parsedQueries };
}

/** Reads and validates a `--corpus` JSON file. */
export async function loadCorpus(path: string): Promise<CustomCorpus> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    throw new Error(`Cannot read corpus ${path}: ${(error as Error).message}`);
  }
  return parseCorpus(raw);
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
    const classes = [...new Set(results.map(r => r.class))];
    const byClass = Object.fromEntries(classes.map(cls => [cls, rankMetrics(results.filter(r => r.class === cls).map(r => r.rank))]));
    const latencies = results.map(r => r.latencyMs);
    return {
      corpus: { source: options.source ?? 'builtin', version: options.version ?? CORPUS_VERSION, notes: notes.length, queries: queries.length, byLang: { es: notes.filter(n => n.lang === 'es').length, en: notes.filter(n => n.lang === 'en').length } },
      overall: rankMetrics(results.map(r => r.rank)),
      byClass,
      latencyMs: { p50: round(percentile(latencies, 50), 2), p95: round(percentile(latencies, 95), 2) },
      queries: results,
    };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
