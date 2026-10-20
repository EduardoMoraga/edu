/** Installed capabilities are readable without initializing a brain or invoking a model. */
import type { Command } from 'commander';
import { getCapabilities } from '../../release/capabilities.js';
import type { CliContext } from '../context.js';
import { action, printJson } from '../kit.js';

export function registerCapabilities(program: Command, ctx: CliContext): void {
  program.command('capabilities')
    .alias('whats-new')
    .description('describe this installed Edu version, improvements, limits and restart requirements')
    .option('--json', 'machine-readable capabilities for agents and scripts')
    .action(action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
      const capabilities = getCapabilities();
      if (g.json || opts.json) return printJson(ctx, capabilities);
      ctx.out(`Edu ${capabilities.version}`);
      for (const feature of capabilities.features) ctx.out(`- ${feature}`);
      ctx.out('\nLimits:');
      for (const limitation of capabilities.limitations) ctx.out(`- ${limitation}`);
      ctx.out('\nCommands:');
      for (const command of capabilities.commands) ctx.out(`  ${command}`);
    }));
}
