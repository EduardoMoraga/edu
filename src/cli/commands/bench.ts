/**
 * `edu bench`: deterministic baseline of memory efficiency (retrieval quality, context cost) and the
 * live-agent activation harness. Runs in temporary brains; never touches the user's brain or calls a model.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import { ACTIVATION_PROMPT, gradeActivation, seedActivation } from '../../bench/activation.js';
import { runContextBench, type ContextReport } from '../../bench/context.js';
import { loadCorpus, runRetrievalBench, type RankMetrics, type RetrievalOptions, type RetrievalReport } from '../../bench/retrieval.js';
import type { CliContext } from '../context.js';
import { action, printJson } from '../kit.js';
import { packageVersion } from '../package.js';

interface BenchOpts { json?: boolean; out?: string; seed?: string; grade?: string; corpus?: string; misses?: boolean }

export const BENCH_SCHEMA = 'edu-bench/1';
const SUITES = ['retrieval', 'context', 'activation'] as const;
type Suite = (typeof SUITES)[number];

export interface BenchReport {
  schema: typeof BENCH_SCHEMA;
  edu: string;
  node: string;
  generatedAt: string;
  retrieval?: RetrievalReport;
  context?: ContextReport;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`.padStart(7);
const metricRow = (label: string, m: RankMetrics) =>
  `${label.padEnd(16)} ${String(m.n).padStart(3)} ${pct(m.recallAt1)} ${pct(m.recallAt5)} ${pct(m.recallAt10)} ${m.mrr.toFixed(3).padStart(6)}`;

function retrievalTable(r: RetrievalReport, misses = false): string[] {
  const corpus = r.corpus.source === 'builtin' ? `corpus v${r.corpus.version}` : `corpus ${r.corpus.source}`;
  return [
    `Retrieval (${corpus}: ${r.corpus.notes} notes, ${r.corpus.byLang.es} es / ${r.corpus.byLang.en} en, ${r.corpus.queries} queries)`,
    `${'class'.padEnd(16)}   n      R@1     R@5    R@10    MRR`,
    ...Object.entries(r.byClass).map(([cls, m]) => metricRow(cls, m)),
    metricRow('overall', r.overall),
    `latency p50 ${r.latencyMs.p50.toFixed(1)} ms · p95 ${r.latencyMs.p95.toFixed(1)} ms (brain.recall, limit 10)`,
    ...(misses ? missLines(r) : []),
  ];
}

/** Queries whose target did not rank first, with what ranked above it. */
function missLines(r: RetrievalReport): string[] {
  const missed = r.queries.filter(q => q.rank !== 1);
  if (!missed.length) return ['', 'misses: none'];
  return ['', `misses (${missed.length}):`, ...missed.map(q =>
    `  ${q.id.padEnd(6)} ${q.class.padEnd(14)} rank ${q.rank === null ? '-' : String(q.rank)}  expected ${q.expected}  top3 ${q.top3.join(', ') || '-'}  "${q.query}"`)];
}

function contextTable(c: ContextReport): string[] {
  const s = c.stability;
  return [
    'Context cost (estimated tokens)',
    `session brief      ${String(c.brief.tokens).padStart(6)}  (budget ${c.brief.budgetTokens}; hook output ${c.brief.hookTokens})`,
    `brief stability    ${s.identical ? 'identical' : 'differs'}; common prefix ${s.commonPrefixTokens}/${s.secondTokens} tokens (${pct(s.commonPrefixRatio).trim()})`,
    ...(s.firstDifference ? [`  first difference: ${s.firstDifference.slice(0, 100)}`] : []),
    `brief after recall ${s.afterRecallIdentical ? 'identical' : 'differs'}`,
    `MCP tools (full)   ${String(c.mcp.full.tokens).padStart(6)}  (${c.mcp.full.tools} tools)`,
    `MCP tools (memory) ${String(c.mcp.memory.tokens).padStart(6)}  (${c.mcp.memory.tools} tools)`,
  ];
}

async function writeOut(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function registerBench(program: Command, ctx: CliContext): void {
  program.command('bench')
    .description('measure memory efficiency in temporary brains: retrieval quality, context cost, live-agent activation')
    .argument('[suite]', `retrieval | context | activation (default: retrieval and context)`)
    .option('--json', 'machine-readable output')
    .option('--out <file>', 'also write the JSON result to <file>')
    .option('--seed <dir>', 'activation: seed <dir>/.edu with the scenario and print the prompt')
    .option('--grade <file>', 'activation: grade an agent answer (text file) from 0 to 5')
    .option('--corpus <file>', 'retrieval: run on a JSON corpus {notes:[{key,title,body,tier,kind,status?,tags?}], queries:[{q,target,class}]}')
    .option('--misses', 'retrieval: list queries whose target did not rank first')
    .action(action<BenchOpts>(ctx, async ({ g, opts }, suiteArg) => {
      const suite = suiteArg as Suite | undefined;
      if (suite && !SUITES.includes(suite)) throw new Error(`Unknown bench suite "${suite}"; use ${SUITES.join(', ')}`);
      if ((opts.seed || opts.grade) && suite !== 'activation') throw new Error('--seed and --grade belong to `edu bench activation`');
      if ((opts.corpus || opts.misses) && suite !== 'retrieval') throw new Error('--corpus and --misses belong to `edu bench retrieval`');
      const json = g.json || opts.json;
      const emit = async (value: unknown, lines: string[]) => {
        if (opts.out) await writeOut(resolve(g.cwd, opts.out), value);
        if (json) printJson(ctx, value);
        else for (const line of lines) ctx.out(line);
      };

      if (suite === 'activation') {
        if (opts.grade) {
          const grade = gradeActivation(await readFile(resolve(g.cwd, opts.grade), 'utf8'));
          return emit(grade, [`activation score ${grade.score}/${grade.max}`, ...grade.checks.map(check => `${check.passed ? '✓' : '✗'} ${check.id.padEnd(16)} ${check.detail}`)]);
        }
        if (opts.seed) {
          const seed = await seedActivation(resolve(g.cwd, opts.seed));
          return emit(seed, json ? [] : [seed.prompt]);
        }
        return emit({ prompt: ACTIVATION_PROMPT }, [ACTIVATION_PROMPT]);
      }

      const report: BenchReport = { schema: BENCH_SCHEMA, edu: packageVersion(), node: process.version, generatedAt: new Date().toISOString() };
      if (!suite || suite === 'retrieval') {
        let options: RetrievalOptions = {};
        if (opts.corpus) {
          const path = resolve(g.cwd, opts.corpus);
          const corpus = await loadCorpus(path);
          options = { notes: corpus.notes, queries: corpus.queries, source: opts.corpus, version: corpus.version };
        }
        report.retrieval = await runRetrievalBench(options);
      }
      if (!suite || suite === 'context') report.context = await runContextBench();
      await emit(report, [
        ...(report.retrieval ? retrievalTable(report.retrieval, opts.misses) : []),
        ...(report.retrieval && report.context ? [''] : []),
        ...(report.context ? contextTable(report.context) : []),
      ]);
    }));
}
