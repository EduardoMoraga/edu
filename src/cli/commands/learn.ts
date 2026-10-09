/** `edu context`, `edu reflect`, `edu proposals list|accept|reject`. */
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ContextPack } from '../../core/contracts.js';
import { formatTokens, type Glyphs } from '../../identity/index.js';
import type { CliContext } from '../context.js';
import { t } from '../i18n.js';
import { action, look, parseIntOption, printJson } from '../kit.js';
import { effectiveConfig, openWorkspace } from '../workspace.js';

/** Section | tokens | notes table, followed by the total against the budget. */
export function tokenTable(pack: ContextPack, glyphs: Glyphs): string[] {
  const width = Math.max(7, ...pack.sections.map((s) => s.title.length));
  const rule = glyphs.rule.repeat(width + 20);
  const rows = pack.sections.map((s) => `${s.title.padEnd(width)}  ${String(s.tokens).padStart(6)}  ${String(s.noteIds.length).padStart(5)}`);
  return [
    `${'section'.padEnd(width)}  ${'tokens'.padStart(6)}  ${'notes'.padStart(5)}`,
    rule,
    ...rows,
    rule,
    `${'total'.padEnd(width)}  ${String(pack.tokens).padStart(6)}  of ${formatTokens(pack.budgetTokens)}`,
  ];
}

interface ContextOpts { query?: string; budget?: string; json?: boolean }

export function registerLearn(program: Command, ctx: CliContext): void {
  program
    .command('context')
    .description('show the context pack Edu would inject, with a token table')
    .option('--query <q>', 'focus the pack on a topic')
    .option('--budget <n>', 'token budget (default: config)')
    .option('--json', 'machine-readable output')
    .action(
      action<ContextOpts>(ctx, async ({ g, opts }) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const config = await effectiveConfig(ws.primary.root, []);
        const budgetTokens = opts.budget ? parseIntOption(opts.budget, '--budget') : config.context.budgetTokens;
        const { buildContext } = await import('../../context/index.js');
        const pack = await buildContext(ws.brain, { budgetTokens, ...(opts.query ? { query: opts.query } : {}) }, { eduMdPath: join(ws.primary.root, 'EDU.md'), trackUsage: false });
        if (g.json || opts.json) return printJson(ctx, pack);
        const { glyphs } = look(ctx);
        ctx.out(t(g.lang, 'context.title', { tokens: pack.tokens, budget: pack.budgetTokens }));
        ctx.out('');
        ctx.out(pack.text);
        ctx.out('');
        for (const line of tokenTable(pack, glyphs)) ctx.out(line);
        if (pack.deferred.length) ctx.out(t(g.lang, 'context.deferred', { count: pack.deferred.length }));
      }),
    );

  program
    .command('reflect')
    .description('learn from recent episodes: lessons, hypotheses, skill proposals')
    .option('--since <window>', 'how far back to look (e.g. 7d, 24h)', '7d')
    .option('--json', 'machine-readable output')
    .action(
      action<{ since?: string; json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const available = await ctx.detectClis();
        if (!available.length) throw new Error(t(g.lang, 'reflect.noCli'));
        const config = await effectiveConfig(ws.primary.root, available);
        const cli = available.includes(config.defaultCli) ? config.defaultCli : available[0]!;
        const [{ reflect }, { createEngine }] = await Promise.all([import('../../reflect/index.js'), import('../../engine/index.js')]);
        const report = await reflect({ brain: ws.brain, engine: createEngine(cli), since: opts.since ?? '7d', brainRoot: ws.primary.root });
        if (g.json || opts.json) return printJson(ctx, report);
        ctx.out(t(g.lang, 'reflect.done', {
          episodes: report.episodesRead,
          lessons: report.lessons.length,
          hypotheses: report.hypotheses.length,
          skills: report.skillProposals.length,
          canonical: report.canonicalProposals.length,
        }));
        for (const p of report.skillProposals) ctx.out(`  ${p.id}  ${p.path}`);
      }),
    );

  const proposals = program.command('proposals').description('review self-improvement proposals (never applied without you)');

  proposals
    .command('list')
    .description('proposals waiting for a decision')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const { listProposals } = await import('../../reflect/index.js');
        const items = (await listProposals(ws.brain, ws.primary.root)).filter((p) => p.status === 'proposed');
        if (g.json || opts.json) return printJson(ctx, items);
        if (!items.length) return ctx.out(t(g.lang, 'proposals.empty'));
        for (const p of items) ctx.out(`${p.id}  ${p.name}  ${p.rationale}`);
      }),
    );

  proposals
    .command('accept')
    .description('apply a proposal')
    .argument('<id>', 'proposal id')
    .action(
      action(ctx, async ({ g }, id) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const { acceptProposal } = await import('../../reflect/index.js');
        const accepted = await acceptProposal(ws.brain, id ?? '', ws.primary.root);
        ctx.out(t(g.lang, 'proposals.accepted', { id: accepted.id, path: accepted.path }));
      }),
    );

  proposals
    .command('reject')
    .description('discard a proposal')
    .argument('<id>', 'proposal id')
    .action(
      action(ctx, async ({ g }, id) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const { rejectProposal } = await import('../../reflect/index.js');
        await rejectProposal(ws.brain, id ?? '', ws.primary.root);
        ctx.out(t(g.lang, 'proposals.rejected', { id: id ?? '' }));
      }),
    );

}
