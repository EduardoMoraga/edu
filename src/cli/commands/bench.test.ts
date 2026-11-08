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

  it('rejects unknown suites and misplaced activation flags', async () => {
    const c = await captureContext();
    await runCli(c, ['bench', 'nope']);
    expect(c.exitCode).toBe(1);
    const d = await captureContext();
    await runCli(d, ['bench', 'retrieval', '--grade', 'x.txt']);
    expect(d.exitCode).toBe(1);
  });
});
