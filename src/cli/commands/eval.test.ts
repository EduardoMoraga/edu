import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { captureContext, err, out } from '../testkit.js';
import { registerEvaluation } from './eval.js';

const costs = { inputTokens: 1, outputTokens: 1, acquisitionTokens: 1, reflectionTokens: 1, wallMs: 1, humanInterventions: 0 };
const base = { model: 'm', harness: 'h', provenance: 'measured', success: true, oracle: 'tests', costs };

async function run(c: Awaited<ReturnType<typeof captureContext>>, argv: string[]) {
  const program = new Command().exitOverride().option('--json').option('--cwd <dir>');
  registerEvaluation(program, c.ctx);
  await program.parseAsync(argv, { from: 'user' });
}

describe('eval CLI', () => {
  it('aggregate of an empty file is inconclusive JSON with limits', async () => {
    const c = await captureContext();
    await mkdir(c.dirs.cwd, { recursive: true });
    await writeFile(join(c.dirs.cwd, 'empty.json'), '[]');
    await run(c, ['eval', 'aggregate', 'empty.json', '--json']);
    expect(c.exitCode).toBeUndefined();
    expect(JSON.parse(out(c))).toMatchObject({ status: 'inconclusive', reasons: ['no-trials'], trials: 0 });
    expect(JSON.parse(out(c)).limits.length).toBeGreaterThan(0);
  });
  it('rejects invalid and mixed-model files with exit code 1', async () => {
    const c = await captureContext();
    await writeFile(join(c.dirs.cwd, 'bad.json'), JSON.stringify([{ ...base, trialId: 'a', taskId: 't', arm: 'edu-cold', success: 'yes' }]));
    await run(c, ['eval', 'aggregate', 'bad.json', '--json']);
    expect(c.exitCode).toBe(1);
    expect(err(c)).toMatch(/Invalid trials/);
    const d = await captureContext();
    await writeFile(join(d.dirs.cwd, 'mixed.json'), JSON.stringify([{ ...base, trialId: 'a', taskId: 't', arm: 'native-clean' }, { ...base, model: 'other', trialId: 'b', taskId: 't', arm: 'edu-cold' }]));
    await run(d, ['eval', 'aggregate', 'mixed.json']);
    expect(d.exitCode).toBe(1);
    expect(err(d)).toMatch(/one model and one harness/);
  });
  it('does not compare arms with unbalanced task frequencies', async () => {
    const c = await captureContext();
    const rows = (arm: string, easy: number, hard: number) => [
      ...Array.from({ length: easy }, (_, i) => ({ ...base, trialId: `${arm}-e${i}`, taskId: 'easy', arm })),
      ...Array.from({ length: hard }, (_, i) => ({ ...base, trialId: `${arm}-h${i}`, taskId: 'hard', arm, success: false })),
    ];
    await writeFile(join(c.dirs.cwd, 'skew.json'), JSON.stringify({ trials: [...rows('native-clean', 2, 18), ...rows('memory-adaptive', 18, 2)] }));
    await run(c, ['eval', 'aggregate', 'skew.json', '--json']);
    const report = JSON.parse(out(c));
    expect(report.status).toBe('inconclusive');
    expect(report.comparisons.find((x: { candidate: string }) => x.candidate === 'memory-adaptive')).toMatchObject({ status: 'inconclusive', successRateDelta: null, reasons: expect.arrayContaining(['unmatched-task-multiset']) });
  });
  it('rejects a trial with a missing cost', async () => {
    const c = await captureContext();
    const { wallMs: _w, ...partial } = costs;
    await writeFile(join(c.dirs.cwd, 'nocost.json'), JSON.stringify([{ ...base, costs: partial, trialId: 'a', taskId: 't', arm: 'edu-cold' }]));
    await run(c, ['eval', 'aggregate', 'nocost.json', '--json']);
    expect(c.exitCode).toBe(1);
    expect(err(c)).toMatch(/wallMs/);
  });
  it('suite prints the arms and flags itself as not an LLM benchmark', async () => {
    const c = await captureContext();
    await run(c, ['eval', 'suite', '--json']);
    const result = JSON.parse(out(c));
    expect(result).toMatchObject({ notALlmBenchmark: true, aggregate: { status: 'inconclusive' } });
    expect(result.byArm['memory-adaptive'].byPhase.correction).toBe('1/2');
  });
});
