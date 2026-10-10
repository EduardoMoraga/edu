/** `edu vault`: linked Obsidian dashboard and diagnostics. */
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { CliContext } from '../context.js';
import { globalHome } from '../context.js';
import { action, printJson } from '../kit.js';
import { checkVault, createVault } from '../../vault/vault.js';

interface VaultOpts { name?: string; register?: boolean; json?: boolean; check?: boolean }

export function registerVault(program: Command, ctx: CliContext): void {
  program.command('vault')
    .description('create or check a safe Obsidian window onto registered project brains')
    .argument('[path]', 'vault directory (default ~/EduVault)')
    .option('--name <name>', 'vault title', 'Edu')
    .option('--no-register', 'do not add the vault to Obsidian')
    .option('--check', 'report unsafe paths, broken links and note counts without writing')
    .option('--json', 'machine-readable output')
    .action(action<VaultOpts>(ctx, async ({ g, opts }, path) => {
      const home = process.platform === 'win32' ? ctx.env.USERPROFILE || ctx.home : ctx.home;
      const vaultPath = path ? resolve(g.cwd, path) : join(home, 'EduVault');
      const common = { path: vaultPath, home, eduHome: globalHome(ctx) };
      if (opts.check) {
        const report = await checkVault(common);
        if (g.json || opts.json) return printJson(ctx, report);
        ctx.out(`Vault: ${report.path}`);
        if (report.unsafe) ctx.err(`Unsafe vault path: ${report.unsafe}`);
        for (const link of report.links) ctx.out(`  ${link.name}: ${link.state} (${link.notes} notes)`);
        for (const name of report.missingProjects) ctx.err(`Missing registered project: ${name}`);
        for (const warning of report.warnings) ctx.err(`Warning: ${warning}`);
        if (report.unsafe || report.links.some(link => link.state !== 'ok')) ctx.setExitCode(1);
        return;
      }
      const report = await createVault({ ...common, name: opts.name, register: opts.register, env: ctx.env });
      if (g.json || opts.json) return printJson(ctx, report);
      ctx.out(`Edu vault: ${report.path}`);
      ctx.out(`Linked: ${report.linked.join(', ') || 'none'}`);
      for (const conflict of report.conflicts) ctx.err(`Link conflict (not replaced): ${conflict}`);
      for (const name of report.missingProjects) ctx.err(`Missing registered project (not removed): ${name}`);
      ctx.out(`Obsidian registration: ${report.registration}`);
      ctx.out(`Next: open Obsidian and choose the ${report.name} vault.`);
    }));
}
