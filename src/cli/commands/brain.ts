/** `edu brain status|recall|remember|maintain|import|link`. */
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { ClaimBand, TransitiveKind } from '../../core/contracts.js';
import type { CliContext } from '../context.js';
import { t, type Lang } from '../i18n.js';
import { action, look, parseIntOption, printJson } from '../kit.js';
import { brainDir, createVaultLink, linkPath } from '../link.js';
import { exists, lessonCount, openWorkspace, type Workspace } from '../workspace.js';

const KINDS: TransitiveKind[] = ['decision', 'hypothesis', 'commitment', 'lesson'];
const BANDS: ClaimBand[] = ['verified', 'inferred', 'hypothesis'];

function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${flag} must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

/** Opens the workspace and requires an initialized primary brain (writes go there). */
async function writableWorkspace(ctx: CliContext, cwd: string, lang: Lang): Promise<Workspace> {
  const ws = await openWorkspace(ctx, cwd);
  if (!(await exists(join(ws.primary.root, 'EDU.md')))) {
    throw new Error(lang === 'es' ? 'No hay cerebro inicializado — ejecuta: edu init' : 'No brain found — run: edu init');
  }
  return ws;
}

interface RecallOpts { limit?: string; json?: boolean }
interface RememberOpts { kind?: string; body?: string; band?: string; due?: string; json?: boolean }

export function registerBrain(program: Command, ctx: CliContext): void {
  const brain = program.command('brain').description('inspect and grow the second brain');

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
    .option('--limit <n>', 'maximum hits', '8')
    .option('--json', 'machine-readable output')
    .action(
      action<RecallOpts>(ctx, async ({ g, opts }, query) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const hits = await ws.brain.recall(query ?? '', { limit: parseIntOption(opts.limit ?? '8', '--limit') });
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
    .command('remember')
    .description('write a decision, hypothesis, commitment or lesson')
    .argument('<title...>', 'one-line title')
    .option('--kind <kind>', KINDS.join(' | '), 'lesson')
    .option('--body <text>', 'markdown body')
    .option('--band <band>', BANDS.join(' | '))
    .option('--due <date>', 'due date for commitments (YYYY-MM-DD)')
    .option('--json', 'machine-readable output')
    .action(
      action<RememberOpts>(ctx, async ({ g, opts }, title) => {
        const kind = oneOf(opts.kind ?? 'lesson', KINDS, '--kind');
        const band = opts.band ? oneOf(opts.band, BANDS, '--band') : undefined;
        const ws = await writableWorkspace(ctx, g.cwd, g.lang);
        const note = await ws.brain.write({
          tier: 'transitive',
          kind,
          title: (title ?? '').trim(),
          body: opts.body ?? '',
          source: 'user',
          ...(band ? { band } : {}),
          ...(opts.due ? { due: opts.due } : {}),
        });
        if (g.json || opts.json) return printJson(ctx, { id: note.meta.id, path: note.path });
        ctx.out(t(g.lang, 'brain.remembered', { id: note.meta.id }));
      }),
    );

  brain
    .command('maintain')
    .description('decay, promote/retire lessons, flag overdue commitments, rebuild the index')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await writableWorkspace(ctx, g.cwd, g.lang);
        const report = await ws.brain.maintain();
        if (g.json || opts.json) return printJson(ctx, report);
        ctx.out(t(g.lang, 'brain.maintained', { changed: report.changed.length, promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length }));
      }),
    );

  brain
    .command('import')
    .description('import an Albert vault or MORAGENT memory (read-only on the source)')
    .argument('<source>', 'albert | moragent')
    .argument('<path>', 'source directory')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }, source, path) => {
        const kind = oneOf(source ?? '', ['albert', 'moragent'] as const, 'source');
        const ws = await writableWorkspace(ctx, g.cwd, g.lang);
        const { importAlbert, importMoragent } = await import('../../brain/index.js');
        const report = await (kind === 'albert' ? importAlbert : importMoragent)(path ?? '', ws.brain);
        if (g.json || opts.json) return printJson(ctx, { imported: report.imported.map((n) => n.meta.id), skipped: report.skipped, errors: report.errors });
        ctx.out(t(g.lang, 'brain.imported', { imported: report.imported.length, skipped: report.skipped.length, errors: report.errors.length }));
        for (const error of report.errors) ctx.err(`  ${error}`);
      }),
    );

  brain
    .command('link')
    .description('link the brain into an Obsidian vault as <vault>/Edu/<project>')
    .argument('<vault>', 'Obsidian vault directory')
    .action(
      action(ctx, async ({ g }, vault) => {
        const ws = await writableWorkspace(ctx, g.cwd, g.lang);
        const vaultPath = resolve(g.cwd, vault ?? '');
        const link = linkPath(vaultPath, ws.primary);
        const target = brainDir(ws.primary);
        let outcome: 'created' | 'exists';
        try {
          outcome = await createVaultLink(link, target);
        } catch (error) {
          if ((error as { code?: string }).code === 'ELINKCONFLICT') throw new Error(t(g.lang, 'brain.linkConflict', { link }));
          throw error;
        }
        const configPath = join(ws.primary.root, 'config.json');
        if (await exists(configPath)) {
          const { loadConfig, saveConfig } = await import('../../orchestrator/config.js');
          const config = await loadConfig(configPath);
          await saveConfig(configPath, { ...config, brain: { ...config.brain, obsidianVault: vaultPath } });
        }
        ctx.out(t(g.lang, outcome === 'created' ? 'brain.linked' : 'brain.linkExists', { link, target }));
      }),
    );
}
