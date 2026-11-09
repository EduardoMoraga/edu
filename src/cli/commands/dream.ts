/** `edu dream`: plan an offline consolidation of recent sessions; `--apply` runs the reviewed plan; `--install` schedules it nightly. */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { globalHome, type CliContext } from '../context.js';
import { action, parseIntOption, printJson } from '../kit.js';
import { effectiveConfig, exists, openWorkspace } from '../workspace.js';

interface DreamOpts { days?: string; staleDays?: string; unusedDays?: string; minSessions?: string; model?: boolean; budget?: string; apply?: boolean; install?: boolean; uninstall?: boolean; hour?: string; json?: boolean }

export function registerDream(program: Command, ctx: CliContext): void {
  program
    .command('dream')
    .description('consolidate recent sessions from every host into a reviewable plan (new lessons, promotions, archive, link and claim fixes); nothing changes until --apply')
    .option('--days <n>', 'closed sessions from the last <n> days', '14')
    .option('--stale-days <n>', 'age after which a time-sensitive claim needs an "(as of YYYY-MM-DD)" marker', '90')
    .option('--unused-days <n>', 'propose archiving candidate lessons and open hypotheses unused this long', '90')
    .option('--min-sessions <n>', 'sessions a topic must recur in to become a new-lesson proposal', '3')
    .option('--model', 'also ask the default agent CLI for proposals over the same evidence (uses a model)')
    .option('--budget <n>', 'prompt token budget with --model', '8000')
    .option('--apply', 'apply the checked proposals of the saved plan (edit the checkboxes first)')
    .option('--install', 'write the plan every night (systemd user timer or macOS LaunchAgent); never applies it')
    .option('--uninstall', 'stop and delete the nightly dream of this project (edu uninstall removes all of them)')
    .option('--hour <n>', 'hour of the nightly run with --install (0-23)', '3')
    .option('--json', 'machine-readable output')
    .action(action<DreamOpts>(ctx, async ({ g, opts }) => {
      const json = g.json || opts.json;
      if (opts.uninstall) {
        if (opts.install) throw new Error('Use --install or --uninstall, not both.');
        const { uninstallDreamSchedules } = await import('../../reflect/dream-schedule.js');
        const removed = await uninstallDreamSchedules({ home: ctx.home, eduHome: globalHome(ctx), cwd: g.cwd });
        if (json) return printJson(ctx, { removed });
        if (!removed.length) ctx.out('No nightly dream is scheduled for this project.');
        for (const r of removed) ctx.out(`Removed the nightly dream (${r.kind}): ${r.removed.join(', ')}`);
        if (removed.some(r => !r.stopped)) ctx.err('The schedule files are deleted but the service manager did not confirm the stop.');
        return;
      }
      const ws = await openWorkspace(ctx, g.cwd);
      if (!(await exists(join(ws.primary.root, 'EDU.md')))) throw new Error('No brain found — run: edu init');
      const plans = await import('../../reflect/dream-plan.js');
      if (opts.install) {
        const hour = Number(opts.hour ?? '3');
        const { installDreamSchedule } = await import('../../reflect/dream-schedule.js');
        const result = await installDreamSchedule({ home: ctx.home, eduHome: globalHome(ctx), node: process.execPath, cli: realpathSync(process.argv[1] ?? ''), cwd: g.cwd, hour, path: ctx.env.PATH });
        if (json) return printJson(ctx, result);
        ctx.out(`Scheduled a nightly dream (${result.kind}, ${String(hour).padStart(2, '0')}:30): ${result.files.join(', ')}`);
        ctx.out('Each run only writes the plan; review it and run edu dream --apply yourself.');
        if (!result.started) ctx.err('The schedule files are written but could not be started; start them by hand.');
        return;
      }
      const { applyDream, planDream } = await import('../../reflect/dream.js');
      if (opts.apply) {
        const plan = await plans.loadDreamPlan(ws.primary);
        if (!plan) throw new Error('No dream plan yet — run: edu dream');
        const { result, plan: updated } = await applyDream(ws.brain, ws.primary, plan);
        await plans.saveDreamPlan(ws.primary, updated);
        if (json) return printJson(ctx, result);
        ctx.out(`Dream applied: ${result.applied.length} proposal(s), ${result.unchecked} left unchecked, ${result.skipped.length} skipped. Backup: ${result.backup}`);
        for (const id of result.written) ctx.out(`  + ${id}`);
        for (const skip of result.skipped) ctx.out(`  - ${skip.id}: ${skip.reason}`);
        return;
      }
      let engine;
      if (opts.model) {
        const available = await ctx.detectClis();
        if (!available.length) throw new Error('--model needs an installed agent CLI (claude, codex, …); run edu dream without --model for the deterministic plan.');
        const config = await effectiveConfig(ws.primary.root, available);
        const { createEngine } = await import('../../engine/index.js');
        engine = createEngine(available.includes(config.defaultCli) ? config.defaultCli : available[0]!);
      }
      const plan = await planDream(ws.brain, ws.primary, {
        days: parseIntOption(opts.days ?? '14', '--days'),
        staleDays: parseIntOption(opts.staleDays ?? '90', '--stale-days'),
        unusedDays: parseIntOption(opts.unusedDays ?? '90', '--unused-days'),
        minSessions: parseIntOption(opts.minSessions ?? '3', '--min-sessions'),
        ...(engine ? { engine, budgetTokens: parseIntOption(opts.budget ?? '8000', '--budget') } : {}),
      });
      const path = await plans.saveDreamPlan(ws.primary, plan);
      if (json) return printJson(ctx, { ...plan, path });
      const checked = plan.proposals.filter(p => p.checked).length;
      ctx.out(`Dream over ${plan.sessions} session(s) from the last ${plan.days} days: ${plan.proposals.length} proposal(s) (${checked} checked), ${plan.findings.length} lint finding(s).`);
      for (const p of plan.proposals) ctx.out(`  [${p.checked ? 'x' : ' '}] ${p.id} ${p.kind.padEnd(16)} ${p.title} (prevalence ${p.prevalence})`);
      if (plan.model?.dropped.length) ctx.out(`  ${plan.model.dropped.length} model proposal(s) dropped (see the plan file).`);
      ctx.out(`Plan: ${path}`);
      ctx.out('Review the checkboxes, then run: edu dream --apply');
    }));
}
