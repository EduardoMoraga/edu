/** `edu brain maintain|tidy|lint`: keep the brain healthy, and report what needs a person. */
import type { Command } from 'commander';
import { autoMaintain } from '../../../brain/auto-maintain.js';
import { LINT_KINDS, lintBrain, type LintReport } from '../../../brain/lint.js';
import { brainPath } from '../../../brain/location.js';
import { TIDY_KINDS, applyTidy, loadTidyPlan, planTidy, saveTidyPlan } from '../../../brain/tidy.js';
import type { CliContext } from '../../context.js';
import { t } from '../../i18n.js';
import { action, parseIntOption, printJson } from '../../kit.js';
import { openWorkspace } from '../../workspace.js';
import { oneOf, writableWorkspace } from './shared.js';

export function registerBrainUpkeep(brain: Command, ctx: CliContext): void {
  brain
    .command('maintain')
    .description('decay, promote/retire lessons, flag overdue commitments, rebuild the index')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await writableWorkspace(ctx, g.cwd, g.lang);
        const result = await autoMaintain(ws.brain, ws.primary.root, { force: true });
        if (!result.ran) throw new Error(result.reason);
        const { report } = result;
        if (g.json || opts.json) return printJson(ctx, report);
        ctx.out(t(g.lang, 'brain.maintained', { changed: report.changed.length, promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length }));
      }),
    );

  brain
    .command('tidy')
    .description('plan what maintenance never cleans (empty sessions, stale hypotheses, broken links with a known target); --apply runs the reviewed plan with a backup')
    .option('--apply', 'apply the saved plan (edit it first to drop what you do not want)')
    .option('--only <kinds>', `with --apply: comma list of ${TIDY_KINDS.join(', ')}`)
    .option('--stale-days <n>', 'age in days after which an open hypothesis is proposed as no-evidence', '30')
    .option('--json', 'machine-readable output')
    .action(
      action<{ apply?: boolean; only?: string; staleDays?: string; json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await writableWorkspace(ctx, g.cwd, g.lang);
        if (opts.apply) {
          const plan = await loadTidyPlan(ws.primary);
          if (!plan) throw new Error(t(g.lang, 'brain.tidyNoPlan'));
          const only = opts.only?.split(',').map(kind => oneOf(kind.trim(), TIDY_KINDS, '--only'));
          const result = await applyTidy(ws.brain, ws.primary, plan, { only });
          if (g.json || opts.json) return printJson(ctx, result);
          ctx.out(t(g.lang, 'brain.tidyApplied', { sessions: result.sessions, hypotheses: result.hypotheses, aliases: result.aliases, skipped: result.skipped.length, backup: result.backup }));
          for (const skip of result.skipped) ctx.out(`  - ${skip.id}: ${skip.reason}`);
          return;
        }
        const staleDays = parseIntOption(opts.staleDays ?? '30', '--stale-days');
        const plan = await planTidy(ws.brain, ws.primary, { staleDays });
        const path = await saveTidyPlan(ws.primary, plan);
        if (g.json || opts.json) return printJson(ctx, { ...plan, path });
        if (!plan.sessions.length && !plan.hypotheses.length && !plan.aliases.length && !plan.manual.length) return ctx.out(t(g.lang, 'brain.tidyNothing'));
        ctx.out(t(g.lang, 'brain.tidyPlan', { sessions: plan.sessions.length, hypotheses: plan.hypotheses.length, days: staleDays, aliases: plan.aliases.length, manual: plan.manual.length, unresolved: plan.unresolved }));
        for (const h of plan.hypotheses) ctx.out(`  H ${h.created.slice(0, 10)} ${h.title}`);
        for (const a of plan.aliases) ctx.out(`  A ${a.id} ← ${a.add.join(', ')}`);
        for (const m of plan.manual) ctx.out(`  ! [[${m.link}]] → ${m.target} (${m.reason})`);
        ctx.out(t(g.lang, 'brain.tidySaved', { path }));
      }),
    );

  brain
    .command('lint')
    .description('read-only health check: orphans, missing pages, possible contradictions, stale claims, overdue commitments, duplicates')
    .option('--stale-days <n>', 'age in days after which a time-sensitive claim without "(as of YYYY-MM-DD)" is stale', '90')
    .option('--strict', 'exit with code 1 when a finding has severity error')
    .option('--json', 'machine-readable output')
    .action(
      action<{ staleDays?: string; strict?: boolean; json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const staleDays = parseIntOption(opts.staleDays ?? '90', '--stale-days');
        const report = await lintBrain(ws.brain, { staleDays, root: brainPath(ws.primary) });
        if (opts.strict && report.summary.error) ctx.setExitCode(1);
        if (g.json || opts.json) return printJson(ctx, report);
        for (const line of lintTable(report)) ctx.out(line);
      }),
    );
}

/** Findings grouped by kind (most actionable first), then the summary counts. */
export function lintTable(report: LintReport): string[] {
  const lines: string[] = [];
  for (const kind of LINT_KINDS) {
    const group = report.findings.filter(finding => finding.kind === kind);
    if (!group.length) continue;
    lines.push(`${kind} (${group.length})`);
    for (const finding of group) {
      lines.push(`  ${finding.severity.padEnd(7)} ${finding.ids.join(', ')}`);
      lines.push(`          ${finding.message}`);
      lines.push(`          fix: ${finding.fix}`);
    }
    lines.push('');
  }
  const { summary } = report;
  if (!summary.total) lines.push(`No findings in ${report.notes} notes.`);
  else lines.push(`${summary.total} finding(s) in ${report.notes} notes: ${summary.error} error · ${summary.warning} warning · ${summary.info} info — ${LINT_KINDS.filter(kind => summary[kind]).map(kind => `${kind} ${summary[kind]}`).join(', ')}`);
  return lines;
}
