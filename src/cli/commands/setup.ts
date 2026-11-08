/** `edu init`, `edu install`, `edu uninstall`. */
import { join } from 'node:path';
import type { Command } from 'commander';
import { exists } from '../workspace.js';
import type { CliId, InstallScope } from '../../core/contracts.js';
import { globalHome, type CliContext } from '../context.js';
import { t } from '../i18n.js';
import { action, printJson } from '../kit.js';
import { packageTemplatesDir } from '../package.js';
import { initBrain } from '../setup.js';
import { registerProject } from '../../vault/registry.js';

export const CLI_CHOICES: CliId[] = ['claude', 'codex', 'pi', 'opencode', 'agy'];

export function parseCli(value: string): CliId {
  const id = value.trim().toLowerCase();
  if (!(CLI_CHOICES as string[]).includes(id)) throw new Error(`Unknown CLI "${value}" (expected ${CLI_CHOICES.join(', ')})`);
  return id as CliId;
}

export function parseCliList(value: string): CliId[] | 'all' {
  if (value.trim().toLowerCase() === 'all') return 'all';
  const list = value.split(',').map((v) => v.trim()).filter(Boolean).map(parseCli);
  if (!list.length) throw new Error('--cli needs at least one CLI');
  return [...new Set(list)];
}

function parseScope(value: string | undefined): InstallScope {
  if (value === undefined || value === 'project') return 'project';
  if (value === 'global') return 'global';
  throw new Error(`--scope must be project or global, got "${value}"`);
}

interface InitOpts { global?: boolean; name?: string; cli?: string }
interface InstallOpts { cli?: string; scope?: string; dryRun?: boolean; yes?: boolean; json?: boolean }
interface UninstallOpts { scope?: string; force?: boolean; yes?: boolean; keepBrain?: boolean; purgeBrain?: boolean }

export function registerSetup(program: Command, ctx: CliContext): void {
  program
    .command('init')
    .description('create a brain: ./.edu (or ~/.edu with --global), config, roles and skills')
    .option('--global', 'initialize the global brain (EDU_HOME or ~/.edu)')
    .option('--name <name>', 'identity name', 'Edu')
    .option('--cli <cli>', 'default CLI (claude, codex, pi, opencode, agy)')
    .action(
      action<InitOpts>(ctx, async ({ g, opts }) => {
        const root = opts.global ? globalHome(ctx) : join(g.cwd, '.edu');
        const detected = await ctx.detectClis();
        const report = await initBrain({
          location: { scope: opts.global ? 'global' : 'project', root },
          templatesDir: packageTemplatesDir(),
          name: opts.name,
          cli: opts.cli ? parseCli(opts.cli) : undefined,
          lang: g.lang,
          detected,
        });
        if (!opts.global) await registerProject(globalHome(ctx), g.cwd);
        ctx.out(t(g.lang, 'init.done', { root: report.root }));
        ctx.out(t(g.lang, report.configCreated ? 'init.config.created' : 'init.config.kept', { cli: report.defaultCli }));
        ctx.out(t(g.lang, 'init.copied', { agents: report.agents.length, skills: report.skills.length }));
        ctx.out('');
        ctx.out(t(g.lang, 'init.next'));
        for (const key of ['init.next.install', 'init.next.demo', 'init.next.run'] as const) {
          ctx.out(`  ${t(g.lang, key, { cli: report.defaultCli })}`);
        }
      }),
    );

  program
    .command('install')
    .description('connect Edu to your coding CLIs (reversible; recorded in a manifest)')
    .option('--cli <list>', 'comma-separated CLIs, or "all" (default: detected CLIs)')
    .option('--scope <scope>', 'project or global', 'project')
    .option('--dry-run', 'print the plan without writing anything')
    .option('-y, --yes', 'apply without asking')
    .option('--json', 'machine-readable plan output')
    .action(
      action<InstallOpts>(ctx, async ({ g, opts }) => {
        const scope = parseScope(opts.scope);
        let clis: CliId[] | 'all';
        if (opts.cli) clis = parseCliList(opts.cli);
        else {
          clis = await ctx.detectClis();
          if (!clis.length) throw new Error(t(g.lang, 'install.noCli'));
        }
        const { planInstall, describePlan, applyInstall, getManifestPath } = await import('../../adapters/index.js');
        const plan = await planInstall({ clis, scope, root: g.cwd, home: ctx.home, templatesDir: packageTemplatesDir() });
        const json = g.json || opts.json;
        if (json && opts.dryRun) {
          printJson(ctx, {
            scope: plan.scope,
            root: plan.root,
            actions: plan.actions.map(({ cli, clis: shared, kind, path, description }) => ({ cli, clis: shared ?? [cli], kind, path, description })),
            notes: plan.notes,
          });
          return;
        }
        ctx.out(describePlan(plan));
        if (opts.dryRun) {
          ctx.out(t(g.lang, 'install.dryRun'));
          return;
        }
        if (!opts.yes) {
          if (!ctx.isTTY || !ctx.stdinIsTTY) throw new Error(t(g.lang, 'install.needYes'));
          if (!(await ctx.confirm(t(g.lang, 'install.confirm')))) {
            ctx.out(t(g.lang, 'install.aborted'));
            return;
          }
        }
        const manifest = await applyInstall(plan);
        const manifestPath = getManifestPath(scope, plan.root, plan.home);
        if (json) printJson(ctx, { manifest: manifestPath, actions: manifest.actions.length });
        else ctx.out(t(g.lang, 'install.done', { count: manifest.actions.length, manifest: manifestPath }));
      }),
    );

  program
    .command('uninstall')
    .description('remove exactly what edu setup / edu install added (global and this project); the brain is kept')
    .option('--scope <scope>', 'only project or only global (default: both)')
    .option('--force', 'restore even if Edu-managed files were edited since install')
    .option('-y, --yes', 'do not ask; with --purge-brain, confirms the deletion when no terminal is available')
    .option('--keep-brain', 'keep the brain (the default)')
    .option('--purge-brain', 'also delete the global brain (EDU_HOME or ~/.edu); asks first')
    .action(
      action<UninstallOpts>(ctx, async ({ g, opts }) => {
        const es = g.lang === 'es';
        if (opts.keepBrain && opts.purgeBrain) throw new Error(es ? 'Use --keep-brain o --purge-brain, no ambos.' : 'Use --keep-brain or --purge-brain, not both.');
        const scope = opts.scope === undefined ? undefined : parseScope(opts.scope);
        const brainRoot = globalHome(ctx);
        let purgeBrain = false;
        if (opts.purgeBrain) {
          const { assertPurgeableBrain } = await import('../../setup/uninstall.js');
          if (await exists(brainRoot)) {
            await assertPurgeableBrain(brainRoot, ctx.home);
            const question = es ? `¿Borrar el cerebro ${brainRoot} con todas sus notas? Esto no se puede deshacer.` : `Delete the brain ${brainRoot} and all its notes? This cannot be undone.`;
            if (ctx.isTTY && ctx.stdinIsTTY) purgeBrain = await ctx.confirm(question);
            else if (opts.yes) purgeBrain = true;
            else throw new Error(es ? '--purge-brain sin terminal necesita también --yes.' : '--purge-brain without a terminal also needs --yes.');
            if (!purgeBrain) ctx.out(es ? 'El cerebro se conserva.' : 'Keeping the brain.');
          }
        }
        const { uninstallEdu } = await import('../../setup/uninstall.js');
        const report = await uninstallEdu({ home: ctx.home, cwd: g.cwd, brainRoot, scope, force: Boolean(opts.force), purgeBrain });
        if (g.json) { printJson(ctx, report); return; }
        if (!report.removed.length) ctx.out(es ? 'Nada que eliminar: no hay instalación de Edu registrada.' : 'Nothing to remove: no recorded Edu installation.');
        for (const scopeName of [...new Set(report.removed.map(r => r.scope))]) ctx.out(t(g.lang, 'uninstall.done', { scope: scopeName }));
        for (const s of report.schedules) ctx.out(es ? `Programación eliminada (${s.kind}): ${s.name}` : `Schedule removed (${s.kind}): ${s.name}`);
        if (report.brain.action === 'purged') ctx.out(es ? `Cerebro borrado: ${report.brain.path} (un remoto de edu sync/join no se toca).` : `Brain deleted: ${report.brain.path} (any edu sync/join remote is untouched).`);
        else if (report.brain.action === 'kept') ctx.out(es ? `Cerebro conservado: ${report.brain.path} (bórrelo con edu uninstall --purge-brain).` : `Brain kept: ${report.brain.path} (delete it with edu uninstall --purge-brain).`);
        ctx.out(es ? 'Para quitar el comando: npm uninstall -g edu-agent' : 'To remove the command too: npm uninstall -g edu-agent');
      }),
    );
}
