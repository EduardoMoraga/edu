/** `edu crew` commands for dispatch, job inspection, and the detached worker. */
import { join } from 'node:path';
import type { Command } from 'commander';
import type { CliId } from '../../core/contracts.js';
import { createCrew, runWorker } from '../../crew/index.js';
import { globalHome, type CliContext } from '../context.js';
import { action } from '../kit.js';

const CLI_IDS = ['claude', 'codex', 'pi', 'opencode', 'agy'] as const;
function parseCli(value: string): CliId {
  if (!(CLI_IDS as readonly string[]).includes(value)) throw new Error(`Unknown CLI "${value}" (expected ${CLI_IDS.join(', ')})`);
  return value as CliId;
}

export function registerCrew(program: Command, ctx: CliContext): void {
  const crew = (cwd: string) => createCrew({ brainRoot: join(cwd, '.edu') });
  const root = program.command('crew').description('dispatch and inspect crew jobs');
  root.command('dispatch <cli> <task>')
    .description('dispatch a crew job')
    .option('--pane', 'dispatch into a visible Herdr pane when available')
    .option('--autonomy <level>', 'readonly, ask, auto, or full', 'ask')
    .action(action<{ pane?: boolean; autonomy?: string }>(ctx, async ({ g, opts }, cliArg, task) => {
      const cli = parseCli(cliArg!);
      const autonomy = opts.autonomy;
      if (!['readonly', 'ask', 'auto', 'full'].includes(autonomy ?? '')) throw new Error('Autonomy must be readonly, ask, auto, or full');
      const job = await crew(g.cwd).dispatch({ cli, task: task!, mode: opts.pane ? 'pane' : 'headless', cwd: g.cwd, autonomy: autonomy as 'readonly' | 'ask' | 'auto' | 'full' });
      ctx.out(JSON.stringify(job));
    }));
  root.command('status [id]')
    .description('show crew jobs or one job')
    .action(action<Record<string, never>>(ctx, async ({ g }, id) => {
      ctx.out(JSON.stringify(await crew(g.cwd).status(id)));
    }));
  root.command('result <id>')
    .description('wait for a crew result')
    .option('--wait <seconds>', 'maximum wait time in seconds', '60')
    .action(action<{ wait?: string }>(ctx, async ({ g, opts }, id) => {
      const wait = Number(opts.wait);
      if (!Number.isFinite(wait) || wait < 0) throw new Error('--wait must be a non-negative number of seconds');
      ctx.out(JSON.stringify(await crew(g.cwd).result(id!, wait)));
    }));
  root.command('worker <id>')
    .description('run a queued crew job (internal detached entry point)')
    .action(async (id: string) => {
      try { await runWorker(id, { brainRoot: ctx.env.EDU_HOME || globalHome(ctx) }); }
      catch (error) { ctx.err(`Crew worker failed: ${error instanceof Error ? error.message : String(error)}`); ctx.setExitCode(1); }
    });
}
