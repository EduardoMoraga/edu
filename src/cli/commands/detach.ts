/** Reversible removal of competing global coding-CLI integrations. */
import type { Command } from 'commander';
import { createDetachPlan, applyDetach, listDetachBackups, undoDetach } from '../../detach/engine.js';
import { parseHosts } from '../../doctor/hosts.js';
import type { CliContext } from '../context.js';
import { action } from '../kit.js';

interface Options { host?: string; dryRun?: boolean; yes?: boolean; keepBinaries?: boolean; undo?: string | boolean; list?: boolean; force?: boolean }

export function registerDetach(program: Command, ctx: CliContext): void {
  program.command('detach')
    .description('reversibly remove competing CLI instructions, hooks, MCP servers and plugins')
    .argument('[tools...]', 'tool IDs to detach (never edu)')
    .option('--host <hosts>', 'comma-separated coding CLI hosts')
    .option('--dry-run', 'show planned edits without writing')
    .option('--yes', 'apply without prompting')
    .option('--keep-binaries', 'do not suggest binary uninstall commands')
    .option('--undo [id]', 'restore the latest or named detach backup')
    .option('--list', 'list active detach backups')
    .option('--force', 'overwrite drifted files during undo')
    .action(action<Options>(ctx, async ({ g, opts }, rawTools) => {
      const es = g.lang === 'es';
      if (opts.list) {
        const ids = await listDetachBackups(ctx.home);
        ctx.out(ids.length ? ids.join('\n') : es ? 'No hay respaldos activos.' : 'No active detach backups.');
        return;
      }
      if (opts.undo !== undefined) {
        const result = await undoDetach({ home: ctx.home, id: typeof opts.undo === 'string' ? opts.undo : undefined, force: opts.force });
        ctx.out(es ? `Restaurado ${result.id}: ${result.restored.join(', ')}` : `Restored ${result.id}: ${result.restored.join(', ')}`);
        return;
      }
      const tools = rawTools?.split(' ').filter(Boolean) ?? [];
      const plan = await createDetachPlan({ home: ctx.home, env: ctx.env, hosts: parseHosts(opts.host), tools });
      const dryRun = opts.dryRun || ((!ctx.isTTY || !ctx.stdinIsTTY) && !opts.yes);
      ctx.out(es ? `Plan: ${plan.files.length} archivo(s), ~${plan.tokensSaved} tokens menos.` : `Plan: ${plan.files.length} file(s), ~${plan.tokensSaved} fewer tokens.`);
      for (const host of plan.hosts) {
        const files = plan.files.filter((file) => file.host === host);
        if (!files.length) continue;
        const tokens = files.reduce((sum, file) => sum + file.tokensSaved, 0);
        ctx.out(es
          ? `  ${host}: ${files.length} archivo(s), ~${tokens} tokens; ${files.flatMap((file) => file.changes).join(', ')}`
          : `  ${host}: ${files.length} file(s), ~${tokens} tokens; ${files.flatMap((file) => file.changes).join(', ')}`);
      }
      if (dryRun || !plan.files.length) { ctx.out(es ? 'Simulación: no se escribió nada.' : 'Dry run: nothing was written.'); return; }
      if (!opts.yes && !(await ctx.confirm(es ? '¿Aplicar estos cambios con respaldo?' : 'Apply these backed-up changes?'))) {
        ctx.out(es ? 'Cancelado: no se escribió nada.' : 'Cancelled: nothing was written.'); return;
      }
      const applied = await applyDetach(plan);
      ctx.out(es ? `Aplicado. Respaldo: ${applied.id}. Revertir: edu detach --undo ${applied.id}` : `Applied. Backup: ${applied.id}. Undo: edu detach --undo ${applied.id}`);
      if (!opts.keepBinaries) {
        const suggestions = [
          plan.tools.includes('gentle-ai') && 'brew uninstall gentle-ai',
          plan.tools.includes('engram') && 'brew uninstall engram',
          plan.tools.includes('moragent') && 'npm uninstall -g moragent',
        ].filter(Boolean);
        if (suggestions.length) ctx.out(es ? `Los binarios siguen instalados. Si ya no se necesitan: ${suggestions.join(' · ')}` : `Binaries remain installed. If no longer needed: ${suggestions.join(' · ')}`);
      }
    }));
}
