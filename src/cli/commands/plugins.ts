/** Native plugin setup command. Registration is pre-wired in program.ts. */
import { dirname, join } from 'node:path';
import type { Command } from 'commander';
import type { CliId } from '../../core/contracts.js';
import { applySetup, needsFirstRunSetup, planSetup } from '../../setup/index.js';
import type { CliContext } from '../context.js';
import { globalHome, type Resolved } from '../context.js';
import { action } from '../kit.js';
import { packageTemplatesDir } from '../package.js';

interface SetupOpts { cli?: string; dryRun?: boolean; yes?: boolean }
const CLIS: CliId[] = ['claude', 'codex', 'pi', 'opencode', 'agy'];

function parseClis(value: string): CliId[] {
  if (value.trim().toLowerCase() === 'all') return [...CLIS];
  const parts = value.split(',').map((part) => part.trim().toLowerCase());
  if (!parts.length || parts.some((part) => !part)) throw new Error('--cli needs at least one CLI');
  const invalid = parts.find((part) => !CLIS.includes(part as CliId));
  if (invalid) throw new Error(`Unknown CLI "${invalid}" (expected ${CLIS.join(', ')})`);
  return [...new Set(parts as CliId[])];
}

function promptFor(cli: CliId, lang: 'en' | 'es'): string {
  const command = cli === 'claude' ? '/edu:brief' : cli === 'pi' || cli === 'opencode' ? '/edu-brief' : 'edu-brief skill';
  return lang === 'es' ? `Dentro de ${cli}, prueba: ${command}` : `Inside ${cli}, try: ${command}`;
}

export async function runPluginSetup(ctx: CliContext, g: Resolved, options: { clis?: CliId[]; yes?: boolean; dryRun?: boolean } = {}): Promise<void> {
  const clis = options.clis ?? await ctx.detectClis();
  const packageRoot = dirname(packageTemplatesDir());
  const plan = await planSetup({ clis, packageRoot, home: ctx.home });
  if (g.json && options.dryRun) {
    ctx.out(JSON.stringify({ clis, commands: plan.commands, fallback: plan.fallback, alreadyInstalled: plan.alreadyInstalled }));
    return;
  }
  if (!g.json && (plan.commands.length || plan.fallback.length)) {
    ctx.out(g.lang === 'es' ? 'Plan de instalación de Edu:' : 'Edu setup plan:');
    for (const cli of clis) {
      const state = plan.alreadyInstalled.includes(cli) ? '✓' : plan.fallback.includes(cli) ? '!' : plan.commands.some((command) => command.cli === cli) ? '✓' : '✗';
      ctx.out(`${state} ${cli}`);
    }
    for (const command of plan.commands) ctx.out(`  $ ${command.command} ${command.args.join(' ')}`);
    for (const cli of plan.fallback) ctx.out(`  ${cli}: ${g.lang === 'es' ? 'se usarán archivos administrados' : 'managed files will be used'}`);
  }
  if (options.dryRun) {
    ctx.out(g.lang === 'es' ? 'Simulación: no se escribió nada.' : 'Dry run: nothing was written.');
    return;
  }
  if (!g.json && (plan.commands.length || plan.fallback.length)) ctx.out('');
  if ((plan.commands.length || plan.fallback.length) && !options.yes) {
    if (!ctx.isTTY || !ctx.stdinIsTTY) throw new Error(g.lang === 'es' ? 'Use --yes para instalar sin confirmación interactiva.' : 'Use --yes to apply setup non-interactively.');
    const question = g.lang === 'es' ? '¿Aplicar esta configuración?' : 'Apply this setup?';
    if (!(await ctx.confirm(question))) { ctx.out(g.lang === 'es' ? 'Cancelado. No se realizaron cambios.' : 'Cancelled. Nothing was changed.'); return; }
  }
  const report = await applySetup(plan, { templatesDir: packageTemplatesDir(), detected: clis, lang: g.lang, brainRoot: globalHome(ctx) });
  if (!g.json) {
    for (const cli of clis) {
      const marker = report.installed.includes(cli) || report.alreadyInstalled.includes(cli) ? '✓' : report.fallback.includes(cli) ? '!' : '✗';
      ctx.out(`${marker} ${cli}${report.fallback.includes(cli) ? (g.lang === 'es' ? ' (integración administrada)' : ' (managed-file integration)') : ''}`);
      const failure = report.failed.find(f => f.cli === cli);
      if (failure) ctx.out(`  ${g.lang === 'es' ? 'instalador nativo falló' : 'native installer failed'}: ${failure.message.split('\n').slice(-2).join(' ').slice(0, 240)}`);
      ctx.out(`  ${promptFor(cli, g.lang)}`);
    }
    if (!clis.length) ctx.out(g.lang === 'es' ? 'No se detectaron CLI; instale uno y ejecute edu setup.' : 'No CLIs detected; install one and run edu setup.');
  }
  if (g.json) ctx.out(JSON.stringify(report));
}

export function registerPluginSetup(program: Command, ctx: CliContext): void {
  program.command('setup')
    .description('install Edu plugins into your coding CLIs')
    .option('--cli <list>', 'comma-separated CLIs')
    .option('--dry-run', 'show the plan without writing')
    .option('-y, --yes', 'apply without asking')
    .action(action<SetupOpts>(ctx, async ({ g, opts }) => {
      const clis = opts.cli ? parseClis(opts.cli) : undefined;
      await runPluginSetup(ctx, g, { clis, yes: Boolean(opts.yes), dryRun: Boolean(opts.dryRun) });
    }));
}

export async function shouldRunFirstSetup(ctx: CliContext): Promise<boolean> {
  return needsFirstRunSetup(globalHome(ctx));
}
