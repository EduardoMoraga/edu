/** `edu eval`: reproducible, honest evaluation reports. Never launches a model, CLI or agent. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { DEFAULT_MIN_TRIALS, aggregateTrials, parseTrials, runMemorySuite } from '../../eval/index.js';
import type { CliContext } from '../context.js';
import { action, parseIntOption, printJson } from '../kit.js';

export function registerEvaluation(program: Command, ctx: CliContext): void {
  const evaluation = program.command('eval').description('honest evaluation of memory: trial aggregation and a deterministic behaviour suite (no model calls)');

  evaluation.command('aggregate')
    .description('aggregate recorded trials (native-clean, edu-cold, memory-static, memory-adaptive) for one model and harness')
    .argument('<file>', 'JSON file: an array of trials or { "trials": [...] }')
    .option('--min-trials <n>', 'minimum trials per arm before a comparison is reported', String(DEFAULT_MIN_TRIALS))
    .option('--json', 'machine-readable output')
    .action(action<{ minTrials?: string; json?: boolean }>(ctx, async ({ g, opts }, file) => {
      const trials = parseTrials(JSON.parse(await readFile(resolve(g.cwd, file ?? ''), 'utf8')));
      const report = aggregateTrials(trials, { minTrialsPerArm: parseIntOption(opts.minTrials ?? String(DEFAULT_MIN_TRIALS), '--min-trials') });
      if (opts.json || g.json) return printJson(ctx, report);
      ctx.out(`status: ${report.status}${report.reasons.length ? ` (${report.reasons.join(', ')})` : ''}`);
      ctx.out(`model: ${report.model ?? '-'}  harness: ${report.harness ?? '-'}  trials: ${report.trials}`);
      for (const [arm, s] of Object.entries(report.arms)) ctx.out(`${arm.padEnd(16)} n=${s.n} success=${(s.successRate * 100).toFixed(0)}% tokens/success=${s.tokensPerSuccess === null ? 'n/a' : s.tokensPerSuccess.toFixed(0)} total-tokens=${s.tokensKnown.total ? s.tokens.total : 'unknown'}`);
      for (const c of report.comparisons) ctx.out(`${c.baseline} -> ${c.candidate}: ${c.status}${c.reasons.length ? ` (${c.reasons.join(', ')})` : ''}`);
      for (const limit of report.limits) ctx.out(`- ${limit}`);
    }));

  evaluation.command('suite')
    .description('run the deterministic transfer -> distractor -> correction memory suite in temporary brains')
    .option('--json', 'machine-readable output')
    .action(action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
      const result = await runMemorySuite();
      const report = aggregateTrials(result.trials);
      if (opts.json || g.json) return printJson(ctx, { ...result, aggregate: report });
      ctx.out('Deterministic memory suite (rule-based solver, NOT an LLM benchmark)');
      for (const [arm, row] of Object.entries(result.byArm)) ctx.out(`${arm.padEnd(16)} ${row.passed}/${row.total}  ${Object.entries(row.byPhase).map(([phase, value]) => `${phase} ${value}`).join('  ')}`);
      ctx.out(`aggregate status: ${report.status} (${report.reasons.join(', ')})`);
      for (const limit of result.limits) ctx.out(`- ${limit}`);
    }));
}
