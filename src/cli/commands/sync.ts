/** `edu sync`: sync the shared brain with its Git remote; `--status` reports; `--install` schedules it. */
import { realpathSync } from 'node:fs';
import type { Command } from 'commander';
import { globalHome, type CliContext } from '../context.js';
import { action, printJson } from '../kit.js';
import { readSyncState, syncBrain, writeSyncState, type SyncResult } from '../../vault/sync.js';
import { installSchedule, notify } from '../../vault/sync-service.js';

interface SyncOpts { status?: boolean; install?: boolean; minutes?: string; cloud?: boolean; host?: string; vault?: string; reason?: string; json?: boolean }

const ALERT = new Set(['conflict', 'error']);

export function describeSync(result: SyncResult | undefined, now = Date.now()): string {
  if (!result) return 'never synced on this machine';
  const minutes = Math.round((now - Date.parse(result.at)) / 60_000);
  const age = minutes < 1 ? 'just now' : minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
  return `${result.state} ${age}: ${result.message}${result.head ? ` (${result.head})` : ''}`;
}

export function registerSync(program: Command, ctx: CliContext): void {
  program.command('sync')
    .description('sync the shared brain with GitHub: generated files never block, conflicts go to a branch')
    .option('--status', 'show the last sync on this machine')
    .option('--install', 'run the sync on a schedule (systemd user timer or macOS LaunchAgent)')
    .option('--minutes <n>', 'schedule interval with --install', '5')
    .option('--cloud', 'cloud sandbox: keep usage counters and Obsidian bases local')
    .option('--host <name>', 'machine label in commit messages and conflict branches')
    .option('--vault <dir>', 'vault repository (default: the repository holding ~/.edu/brain)')
    .option('--reason <why>', 'what triggered the sync (timer, start, stop...)', 'manual')
    .option('--json', 'machine-readable output')
    .action(action<SyncOpts>(ctx, async ({ g, opts }) => {
      const eduHome = globalHome(ctx);
      const json = g.json || opts.json;
      if (opts.status) {
        const last = await readSyncState(eduHome);
        if (json) return printJson(ctx, last ?? null);
        ctx.out(`Sync: ${describeSync(last)}`);
        if (last?.branch) ctx.out(`Conflict branch: ${last.branch}`);
        if (!last || ALERT.has(last.state)) ctx.setExitCode(1);
        return;
      }
      if (opts.install) {
        const minutes = Number(opts.minutes);
        if (!Number.isInteger(minutes) || minutes < 1) throw new Error('--minutes must be a whole number of minutes');
        const result = await installSchedule({ home: ctx.home, node: process.execPath, cli: realpathSync(process.argv[1] ?? ''), minutes, path: ctx.env.PATH });
        if (json) return printJson(ctx, result);
        ctx.out(`Scheduled sync (${result.kind}, every ${minutes} min): ${result.files.join(', ')}`);
        if (!result.started) ctx.err('The schedule files are written but could not be started; start them by hand.');
        ctx.out('Remove any older hand-made sync job (for example edu-vault-sync.timer) so only this one runs.');
        return;
      }
      const cloud = Boolean(opts.cloud) || ctx.env.EDU_SYNC_CLOUD === '1';
      const result = await syncBrain({ eduHome, vault: opts.vault, host: opts.host, cloud, reason: opts.reason, env: ctx.env });
      const previous = await writeSyncState(eduHome, result);
      // Alert once per new problem, not every five minutes.
      if (!cloud && ALERT.has(result.state) && (previous?.state !== result.state || previous?.branch !== result.branch)) {
        await notify(result.state === 'conflict' ? 'Edu: conflicto de sincronización' : 'Edu: el sync falló', result.message);
      }
      if (json) return printJson(ctx, result);
      ctx.out(`Sync: ${describeSync(result)}`);
      for (const file of result.resolved) ctx.out(`  kept upstream: ${file}`);
      if (ALERT.has(result.state)) ctx.setExitCode(1);
    }));
}
