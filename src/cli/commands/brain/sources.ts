/** `edu brain import|link`: bring notes in from Albert or MORAGENT, and expose the brain in an Obsidian vault. */
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { CliContext } from '../../context.js';
import { t } from '../../i18n.js';
import { action, printJson } from '../../kit.js';
import { brainDir, createVaultLink, linkPath } from '../../../vault/link.js';
import { exists } from '../../workspace.js';
import { oneOf, writableWorkspace } from './shared.js';

export function registerBrainSources(brain: Command, ctx: CliContext): void {
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
        const { importAlbert, importMoragent } = await import('../../../brain/index.js');
        const report = await (kind === 'albert' ? importAlbert : importMoragent)(resolve(g.cwd, path ?? ''), ws.brain);
        if (g.json || opts.json) return printJson(ctx, { imported: report.imported.map((n) => n.meta.id), skipped: report.skipped, errors: report.errors, warnings: report.warnings });
        ctx.out(t(g.lang, 'brain.imported', { imported: report.imported.length, skipped: report.skipped.length, errors: report.errors.length, warnings: report.warnings.length }));
        for (const warning of report.warnings) ctx.err(`  ${t(g.lang, 'brain.importWarning', { warning })}`);
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
          const { loadConfig, saveConfig } = await import('../../../workspace/config.js');
          const config = await loadConfig(configPath);
          await saveConfig(configPath, { ...config, brain: { ...config.brain, obsidianVault: vaultPath } });
        }
        ctx.out(t(g.lang, outcome === 'created' ? 'brain.linked' : 'brain.linkExists', { link, target }));
      }),
    );
}
