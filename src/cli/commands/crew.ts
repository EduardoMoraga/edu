/** `edu crew` commands for dispatch, job inspection, and the detached worker. */
import type { Command } from 'commander';
import { CLI_IDS, type CliId } from '../../core/contracts.js';
import { createCrew, runWorker } from '../../crew/index.js';
import { CREW_BRAIN_ENV } from '../../crew/headless.js';
import { isCrewWorker } from '../../crew/store.js';
import { CREW_POLICY_ENV, decodeWorkerPolicy } from '../../workspace/config.js';
import { globalHome, type CliContext } from '../context.js';
import { action } from '../kit.js';
import { openWorkspace } from '../workspace.js';

function parseCli(value: string): CliId {
  if (!(CLI_IDS as readonly string[]).includes(value)) throw new Error(`Unknown CLI "${value}" (expected ${CLI_IDS.join(', ')})`);
  return value as CliId;
}

export function registerCrew(program: Command, ctx: CliContext): void {
  const crew = async (cwd: string) => {
    const ws = await openWorkspace(ctx, cwd);
    return createCrew({ brainRoot: ws.primary.root, locations: ws.locations, workspaceRoot: cwd });
  };
  const root = program.command('crew').description('dispatch and inspect crew jobs');
  root.command('dispatch <cli> <task>')
    .description('dispatch a crew job')
    .option('--pane', 'dispatch into a visible Herdr pane when available')
    .option('--autonomy <level>', 'readonly, ask, auto, or full', 'ask')
    .option('--timeout <minutes>', 'stop a headless job after this many minutes (default: crew.timeoutMinutes in config.json, else 60)')
    .action(action<{ pane?: boolean; autonomy?: string; timeout?: string }>(ctx, async ({ g, opts }, cliArg, task) => {
      const cli = parseCli(cliArg!);
      const autonomy = opts.autonomy;
      if (!['readonly', 'ask', 'auto', 'full'].includes(autonomy ?? '')) throw new Error('Autonomy must be readonly, ask, auto, or full');
      const timeoutMinutes = opts.timeout === undefined ? undefined : Number(opts.timeout);
      const job = await (await crew(g.cwd)).dispatch({ cli, task: task!, mode: opts.pane ? 'pane' : 'headless', cwd: g.cwd, autonomy: autonomy as 'readonly' | 'ask' | 'auto' | 'full', timeoutMinutes });
      ctx.out(JSON.stringify(job));
    }));
  root.command('cancel <id>')
    .description('cancel a crew job: stop its worker (or close its pane) and mark it cancelled')
    .action(action<Record<string, never>>(ctx, async ({ g }, id) => {
      ctx.out(JSON.stringify(await (await crew(g.cwd)).cancel(id!)));
    }));
  root.command('status [id]')
    .description('show crew jobs or one job')
    .action(action<Record<string, never>>(ctx, async ({ g }, id) => {
      ctx.out(JSON.stringify(await (await crew(g.cwd)).status(id)));
    }));
  root.command('result <id>')
    .description('wait for a crew result')
    .option('--wait <seconds>', 'maximum wait time in seconds', '60')
    .action(action<{ wait?: string }>(ctx, async ({ g, opts }, id) => {
      const wait = Number(opts.wait);
      if (!Number.isFinite(wait) || wait < 0) throw new Error('--wait must be a non-negative number of seconds');
      ctx.out(JSON.stringify(await (await crew(g.cwd)).result(id!, wait)));
    }));
  for (const [name, approved] of [['approve', true], ['reject', false]] as const) {
    root.command(`${name} <id>`)
      .description(`${name} the pending orchestration approval`)
      .option('--request <requestId>', 'the approval request you reviewed (see `edu crew status <id>`); refused if another gate is open now')
      .option('--via <channel>', 'who is deciding: cli (default) or deck', 'cli')
      .action(action<{ request?: string; via?: string }>(ctx, async ({ g, opts }, id) => {
        // A crew worker carries EDU_CREW_JOB; it may never approve, whatever flags it passes.
        if (isCrewWorker(ctx.env)) throw new Error(`A crew worker cannot ${name} crew jobs`);
        if (opts.via !== 'cli' && opts.via !== 'deck') throw new Error('--via must be cli or deck');
        ctx.out(JSON.stringify(await (await crew(g.cwd)).approve(id!, approved, { by: opts.via, requestId: opts.request, env: ctx.env })));
      }));
  }
  root.command('worker <id>')
    .description('run a queued crew job (internal detached entry point)')
    .action(async (id: string) => {
      // The dispatcher names the job's brain and hands down the safety policy it resolved; EDU_HOME stays the
      // person's global home. Without a policy (not started by a dispatcher) the defaults apply.
      const globalRoot = globalHome(ctx);
      try { await runWorker(id, { brainRoot: ctx.env[CREW_BRAIN_ENV] || globalRoot, globalRoot, policy: decodeWorkerPolicy(ctx.env[CREW_POLICY_ENV]) }); }
      catch (error) { ctx.err(`Crew worker failed: ${error instanceof Error ? error.message : String(error)}`); ctx.setExitCode(1); }
    });
}
