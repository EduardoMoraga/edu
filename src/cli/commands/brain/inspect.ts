/** `edu brain status|recall|read`: look at the brain without changing it. */
import type { Command } from 'commander';
import type { CliContext } from '../../context.js';
import { t } from '../../i18n.js';
import { action, look, parseIntOption, printJson } from '../../kit.js';
import { lessonCount, openWorkspace } from '../../workspace.js';
import { collect } from './shared.js';

interface RecallOpts { limit?: string; json?: boolean; alt?: string[] }

export function registerBrainInspect(brain: Command, ctx: CliContext): void {
  brain
    .command('status')
    .description('notes per tier, kind and status')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const stats = await ws.brain.stats();
        if (g.json || opts.json) return printJson(ctx, { locations: ws.locations, ...stats });
        const { glyphs } = look(ctx);
        ctx.out(`${glyphs.brain} ${stats.total} notes ${glyphs.sep} ${lessonCount(stats.byStatus)} lessons`);
        for (const loc of ws.locations) ctx.out(`  ${loc.scope.padEnd(8)} ${loc.root}`);
        ctx.out(`  canonical ${stats.byTier.canonical} ${glyphs.sep} episodic ${stats.byTier.episodic} ${glyphs.sep} transitive ${stats.byTier.transitive}`);
        const kinds = Object.entries(stats.byKind).sort(([a], [b]) => a.localeCompare(b));
        if (kinds.length) ctx.out(`  ${kinds.map(([k, n]) => `${k} ${n}`).join(` ${glyphs.sep} `)}`);
      }),
    );

  brain
    .command('recall')
    .description('search the brain (relevance × learned weight)')
    .argument('<query...>', 'what to look for')
    .option('--alt <query>', 'the same question rephrased or translated, fused with it (repeatable, up to 3)', collect, [])
    .option('--limit <n>', 'maximum hits', '8')
    .option('--json', 'machine-readable output')
    .action(
      action<RecallOpts>(ctx, async ({ g, opts }, query) => {
        const alt = opts.alt ?? [];
        if (alt.length > 3) throw new Error('--alt accepts at most 3 phrasings');
        const ws = await openWorkspace(ctx, g.cwd);
        const hits = await ws.brain.recall(alt.length ? [query ?? '', ...alt] : query ?? '', { limit: parseIntOption(opts.limit ?? '8', '--limit') });
        if (g.json || opts.json) {
          return printJson(ctx, hits.map((h) => ({ id: h.note.meta.id, title: h.note.meta.title, tier: h.note.meta.tier, band: h.note.meta.band, score: h.score, why: h.why })));
        }
        if (!hits.length) return ctx.out(t(g.lang, 'brain.empty'));
        for (const hit of hits) {
          const band = hit.note.meta.band ? ` [${hit.note.meta.band}]` : '';
          ctx.out(`${hit.score.toFixed(2).padStart(6)}  ${hit.note.meta.id}${band}  ${hit.note.meta.title}`);
          ctx.out(`        ${hit.why}`);
        }
      }),
    );

  brain
    .command('read')
    .description('print a note: id, legacy id or alias (D-010), unique id prefix, filename or exact title')
    .argument('<reference...>', 'what the note is called')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts, cmd }) => {
        const reference = (cmd.args as string[]).join(' ').trim();
        const ws = await openWorkspace(ctx, g.cwd);
        const result = await ws.brain.resolve(reference);
        const json = g.json || opts.json;
        if (!result) {
          ctx.setExitCode(1);
          return json ? printJson(ctx, { reference, found: false }) : ctx.err(t(g.lang, 'brain.readMissing', { reference }));
        }
        if ('candidates' in result) {
          ctx.setExitCode(1);
          if (json) return printJson(ctx, { reference, ambiguous: true, via: result.via, candidates: result.candidates.map((n) => ({ id: n.meta.id, title: n.meta.title, legacy_id: n.meta.legacy_id })) });
          ctx.out(t(g.lang, 'brain.readAmbiguous', { reference, via: result.via, count: result.candidates.length }));
          for (const n of result.candidates) ctx.out(`  ${n.meta.id}  ${n.meta.title}`);
          return;
        }
        const { note, via } = result;
        if (json) return printJson(ctx, { via, id: note.meta.id, path: note.path, meta: note.meta, body: note.body });
        const { glyphs } = look(ctx);
        ctx.out(`${note.meta.id} ${glyphs.sep} ${note.meta.title}${note.meta.status ? ` ${glyphs.sep} ${note.meta.status}` : ''}${note.meta.band ? ` [${note.meta.band}]` : ''}`);
        ctx.out(note.path);
        ctx.out('');
        ctx.out(note.body);
      }),
    );
}
