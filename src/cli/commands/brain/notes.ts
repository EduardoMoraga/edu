/** `edu brain remember|share`: write a transitive note, or move one between the project and global brains. */
import { join } from 'node:path';
import type { Command } from 'commander';
import { compileReportLines } from '../../../brain/compile.js';
import { brainPath, isInside } from '../../../brain/location.js';
import type { ClaimBand, TransitiveKind } from '../../../core/contracts.js';
import type { CliContext } from '../../context.js';
import { t } from '../../i18n.js';
import { action, printJson } from '../../kit.js';
import { exists, openWorkspace } from '../../workspace.js';
import { oneOf, writableWorkspace } from './shared.js';

const KINDS: TransitiveKind[] = ['decision', 'hypothesis', 'commitment', 'lesson'];
const BANDS: ClaimBand[] = ['verified', 'inferred', 'hypothesis'];

interface RememberOpts { kind?: string; body?: string; band?: string; due?: string; json?: boolean }

export function registerBrainNotes(brain: Command, ctx: CliContext): void {
  brain
    .command('remember')
    .description('write a decision, hypothesis, commitment or lesson')
    .argument('<title...>', 'one-line title')
    .option('--kind <kind>', KINDS.join(' | '), 'lesson')
    .option('--body <text>', 'markdown body')
    .option('--band <band>', `${BANDS.join(' | ')} (default hypothesis)`)
    .option('--due <date>', 'due date for commitments (YYYY-MM-DD)')
    .option('--json', 'machine-readable output')
    .action(
      action<RememberOpts>(ctx, async ({ g, opts }, title) => {
        const kind = oneOf(opts.kind ?? 'lesson', KINDS, '--kind');
        // A note always states its claim band; without --band it is an unproven hypothesis, and the output says so.
        const band = opts.band ? oneOf(opts.band, BANDS, '--band') : 'hypothesis';
        const ws = await writableWorkspace(ctx, g.cwd, g.lang);
        // remember = write + compile: related notes are linked and likely contradictions reported.
        const { note, report } = await ws.brain.remember({
          tier: 'transitive',
          kind,
          title: (title ?? '').trim(),
          body: opts.body ?? '',
          source: 'user',
          band,
          ...(opts.due ? { due: opts.due } : {}),
        });
        if (g.json || opts.json) return printJson(ctx, { id: note.meta.id, path: note.path, band, report });
        ctx.out(t(g.lang, 'brain.remembered', { id: note.meta.id }));
        if (!opts.band) ctx.out(`  ${t(g.lang, 'brain.defaultBand')}`);
        for (const line of compileReportLines(report)) ctx.out(`  ${line}`);
      }),
    );

  brain
    .command('share')
    .description('move a note to the shared global brain (default) or back to this project, keeping its id')
    .argument('<id>', 'note id, alias, unique prefix or exact title')
    .option('--to <scope>', 'global | project', 'global')
    .option('--json', 'machine-readable output')
    .action(
      action<{ to?: string; json?: boolean }>(ctx, async ({ g, opts }, reference) => {
        const scope = oneOf(opts.to ?? 'global', ['global', 'project'] as const, '--to');
        const ws = await openWorkspace(ctx, g.cwd);
        const target = ws.locations.find(loc => loc.scope === scope);
        const es = g.lang === 'es';
        if (!target || !(await exists(join(target.root, 'EDU.md')))) {
          throw new Error(scope === 'global'
            ? (es ? 'No hay cerebro global inicializado — ejecuta: edu init --global' : 'No global brain found — run: edu init --global')
            : (es ? 'No hay cerebro de proyecto aquí — ejecuta: edu init' : 'No project brain here — run: edu init'));
        }
        const result = await ws.brain.resolve(reference ?? '');
        if (!result) throw new Error(t(g.lang, 'brain.readMissing', { reference: reference ?? '' }));
        if ('candidates' in result) throw new Error(`${t(g.lang, 'brain.readAmbiguous', { reference: reference ?? '', via: result.via, count: result.candidates.length })} ${result.candidates.map(note => note.meta.id).join(', ')}`);
        const from = ws.locations.find(loc => isInside(brainPath(loc), result.note.path))?.scope ?? ws.primary.scope;
        const moved = await ws.brain.move(result.note.meta.id, target.root);
        if (g.json || opts.json) return printJson(ctx, { id: moved.meta.id, from, to: scope, path: moved.path });
        ctx.out(es ? `Compartida ${moved.meta.id}: ${from} → ${scope} (${moved.path})` : `Shared ${moved.meta.id}: ${from} → ${scope} (${moved.path})`);
      }),
    );
}
