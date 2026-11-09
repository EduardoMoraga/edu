import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVATION_NOTES, ACTIVATION_PROMPT } from '../../bench/activation.js';
import { captureContext, out, runCli } from '../testkit.js';

describe('edu bench', () => {
  it('prints machine-readable retrieval and context results and writes --out', async () => {
    const c = await captureContext();
    await runCli(c, ['bench', '--json', '--out', 'bench.json']);
    expect(c.exitCode).toBeUndefined();
    const report = JSON.parse(out(c));
    expect(report).toMatchObject({ schema: 'edu-bench/1', edu: expect.any(String), node: process.version });
    for (const cls of ['keyword', 'paraphrase', 'cross-language', 'id']) {
      expect(Object.keys(report.retrieval.byClass[cls]).sort()).toEqual(['mrr', 'n', 'recallAt1', 'recallAt10', 'recallAt5']);
    }
    expect(report.retrieval.overall.n).toBe(report.retrieval.corpus.queries);
    expect(report.retrieval.latencyMs).toEqual({ p50: expect.any(Number), p95: expect.any(Number) });
    expect(report.context.brief.tokens).toBeGreaterThan(0);
    expect(typeof report.context.stability.identical).toBe('boolean');
    expect(report.context.mcp.full.tools).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(c.dirs.cwd, 'bench.json'), 'utf8')).schema).toBe('edu-bench/1');
  }, 30_000);

  it('prints a compact table for a single suite', async () => {
    const c = await captureContext();
    await runCli(c, ['bench', 'context']);
    expect(c.exitCode).toBeUndefined();
    expect(out(c)).toContain('session brief');
    expect(out(c)).not.toContain('Retrieval');
  });

  it('seeds the activation scenario and grades an answer file', async () => {
    const c = await captureContext();
    await runCli(c, ['bench', 'activation', '--seed', 'scenario']);
    expect(out(c)).toBe(ACTIVATION_PROMPT);
    c.stdout.length = 0;
    await writeFile(join(c.dirs.cwd, 'answer.txt'), `Vigente: ${ACTIVATION_NOTES.active.id}. Siguiente paso: revisar.`);
    await runCli(c, ['bench', 'activation', '--grade', 'answer.txt', '--json']);
    const grade = JSON.parse(out(c));
    expect(grade).toMatchObject({ score: 2, max: 5 });
    expect(grade.checks).toHaveLength(5);
  });

  it('runs retrieval on a --corpus JSON file with free-form classes and lists misses', async () => {
    const c = await captureContext();
    const corpus = {
      notes: [
        { key: 'lock', title: 'Use advisory locks for the scheduler', body: 'Workers take a Postgres advisory lock before a job runs.', tier: 'transitive', kind: 'decision', tags: ['jobs'] },
        { key: 'invoice', title: 'Facturación mensual', body: 'Las facturas se emiten el día 25.', tier: 'transitive', kind: 'lesson', status: 'proven' },
        { key: 'lang', title: 'Respond in Spanish', body: 'Replies to the owner are in Spanish.', tier: 'canonical', kind: 'preference' },
      ],
      queries: [
        { q: 'advisory lock scheduler', target: 'lock', class: 'exact' },
        { q: 'facturas día 25', target: 'invoice', class: 'exact' },
        { q: 'monthly invoices', target: 'invoice', class: 'bridge' },
        { q: 'nothing matches zzzz', target: 'lang', class: 'hopeless' },
      ],
    };
    await writeFile(join(c.dirs.cwd, 'corpus.json'), JSON.stringify(corpus));
    await runCli(c, ['bench', 'retrieval', '--corpus', 'corpus.json', '--json']);
    expect(c.exitCode).toBeUndefined();
    const report = JSON.parse(out(c)).retrieval;
    expect(report.corpus).toMatchObject({ source: 'corpus.json', version: 0, notes: 3, queries: 4 });
    expect(Object.keys(report.byClass)).toEqual(['exact', 'bridge', 'hopeless']);
    expect(report.byClass.exact).toMatchObject({ n: 2, recallAt1: 1 });
    expect(report.byClass.bridge.recallAt1).toBe(1);
    expect(report.byClass.hopeless).toMatchObject({ n: 1, recallAt10: 0, mrr: 0 });
    expect(report.overall).toMatchObject({ n: 4, recallAt1: 0.75 });
    expect(report.queries.map((q: { id: string }) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4']);

    const t = await captureContext();
    await writeFile(join(t.dirs.cwd, 'corpus.json'), JSON.stringify(corpus));
    await runCli(t, ['bench', 'retrieval', '--corpus', 'corpus.json', '--misses']);
    expect(out(t)).toContain('corpus corpus.json: 3 notes');
    expect(out(t)).toMatch(/misses \(1\):\n {2}q4 +hopeless +rank - +expected lang/);
  }, 30_000);

  it('fuses corpus alt phrasings unless --no-alt', async () => {
    const corpus = {
      notes: [
        { key: 'pager', title: 'On-call escalation', body: 'When the pager fires twice in an hour, escalate to the platform lead.', tier: 'transitive', kind: 'decision' },
        { key: 'vac', title: 'Vacaciones', body: 'Las vacaciones se piden con dos semanas de anticipación.', tier: 'transitive', kind: 'decision' },
      ],
      queries: [{ q: '¿a quién avisamos cuando suena el buscapersonas?', alt: ['who do we escalate to when the pager fires'], target: 'pager', class: 'cross' }],
    };
    const run = async (...extra: string[]) => {
      const c = await captureContext();
      await writeFile(join(c.dirs.cwd, 'corpus.json'), JSON.stringify(corpus));
      await runCli(c, ['bench', 'retrieval', '--corpus', 'corpus.json', '--json', ...extra]);
      expect(c.exitCode).toBeUndefined();
      return JSON.parse(out(c)).retrieval;
    };
    const fused = await run();
    expect(fused.queries[0]).toMatchObject({ alt: corpus.queries[0]!.alt, rank: 1 });
    const alone = await run('--no-alt');
    expect(alone.queries[0].alt).toBeUndefined();
    expect(alone.queries[0].rank).not.toBe(1);
    const d = await captureContext();
    await runCli(d, ['bench', 'context', '--no-alt']);
    expect(d.exitCode).toBe(1);
  }, 30_000);

  it('rejects an invalid --corpus file and --corpus outside retrieval', async () => {
    const c = await captureContext();
    await writeFile(join(c.dirs.cwd, 'bad.json'), JSON.stringify({ notes: [{ key: 'a', title: 'A', body: '', tier: 'transitive', kind: 'decision' }], queries: [{ q: 'a', target: 'missing', class: 'x' }] }));
    await runCli(c, ['bench', 'retrieval', '--corpus', 'bad.json']);
    expect(c.exitCode).toBe(1);
    const d = await captureContext();
    await runCli(d, ['bench', 'context', '--corpus', 'bad.json']);
    expect(d.exitCode).toBe(1);
  });

  it('rejects unknown suites and misplaced activation flags', async () => {
    const c = await captureContext();
    await runCli(c, ['bench', 'nope']);
    expect(c.exitCode).toBe(1);
    const d = await captureContext();
    await runCli(d, ['bench', 'retrieval', '--grade', 'x.txt']);
    expect(d.exitCode).toBe(1);
  });
});
