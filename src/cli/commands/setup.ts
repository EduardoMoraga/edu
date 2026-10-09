/** `edu init`, `edu install`, `edu uninstall`. */
import { join } from 'node:path';
import type { Command } from 'commander';
import type { CliId, InstallScope } from '../../core/contracts.js';
import { globalHome, type CliContext } from '../context.js';
import { t } from '../i18n.js';
import { action, printJson } from '../kit.js';
import { packageTemplatesDir } from '../package.js';
import { initBrain } from '../setup.js';

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
interface UninstallOpts { scope?: string; force?: boolean }

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
    .description('reverse an Edu installation from its manifest')
    .option('--scope <scope>', 'project or global', 'project')
    .option('--force', 'restore even if Edu-managed files were edited since install')
    .action(
      action<UninstallOpts>(ctx, async ({ g, opts }) => {
        const scope = parseScope(opts.scope);
        const { uninstall, getManifestPath } = await import('../../adapters/index.js');
        await uninstall({ manifestPath: getManifestPath(scope, g.cwd, ctx.home), force: Boolean(opts.force) });
        ctx.out(t(g.lang, 'uninstall.done', { scope }));
      }),
    );
}
