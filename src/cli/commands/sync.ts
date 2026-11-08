/** `edu sync`: sync the shared brain with its Git remote; `--status` reports; `--install` schedules it. */
import { realpathSync } from 'node:fs';
import type { Command } from 'commander';
import { globalHome, type CliContext } from '../context.js';
import { action, printJson } from '../kit.js';
import { conflictBranches, findVault, readSyncState, remoteUrl, syncBrain, writeSyncState, type SyncResult } from '../../vault/sync.js';
import { installSchedule, notify, scheduleStatus, uninstallSchedule, type ScheduleResult, type ScheduleStatus } from '../../vault/sync-service.js';

interface SyncOpts { status?: boolean; install?: boolean; uninstall?: boolean; minutes?: string; cloud?: boolean; host?: string; vault?: string; reason?: string; json?: boolean }

const ALERT = new Set(['conflict', 'error']);

export function describeSync(result: SyncResult | undefined, now = Date.now()): string {
  if (!result) return 'never synced on this machine';
  const minutes = Math.round((now - Date.parse(result.at)) / 60_000);
  const age = minutes < 1 ? 'just now' : minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
  return `${result.state} ${age}: ${result.message}${result.head ? ` (${result.head})` : ''}`;
}

/** The user's home for per-user schedules (USERPROFILE on Windows). */
const userHome = (ctx: CliContext) => process.platform === 'win32' ? ctx.env.USERPROFILE || ctx.home : ctx.home;

/** Schedules `edu sync` with this node and CLI; keeps a non-default EDU_HOME and cloud mode. */
export async function scheduleSync(ctx: CliContext, options: { minutes: number; cloud?: boolean }): Promise<ScheduleResult> {
  const eduHome = globalHome(ctx);
  return installSchedule({
    home: userHome(ctx), eduHome, node: process.execPath, cli: realpathSync(process.argv[1] ?? ''), minutes: options.minutes, path: ctx.env.PATH,
    args: options.cloud ? ['--cloud'] : [], env: ctx.env.EDU_HOME ? { EDU_HOME: eduHome } : {},
  });
}

export function parseMinutes(value: string | undefined): number {
  const minutes = Number(value ?? '5');
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('--minutes must be a whole number of minutes');
  return minutes;
}

export interface SyncStatus {
  last: SyncResult | null;
  vault: string | null;
  /** origin URL, credentials redacted. */
  remote: string | null;
  scheduler: ScheduleStatus;
  /** `sync-conflict/*` branches known on this machine (local or fetched). */
  conflictBranches: string[];
}

export async function syncStatus(ctx: CliContext, vaultOption?: string): Promise<SyncStatus> {
  const eduHome = globalHome(ctx);
  const last = await readSyncState(eduHome) ?? null;
  const vault = vaultOption ?? last?.vault ?? await findVault(eduHome, ctx.env).catch(() => undefined);
  return {
    last, vault: vault ?? null,
    remote: vault ? await remoteUrl(vault, ctx.env) ?? null : null,
    scheduler: await scheduleStatus({ home: userHome(ctx), eduHome }),
    conflictBranches: vault ? await conflictBranches(vault, ctx.env) : [],
  };
}

export function printSync(ctx: CliContext, result: SyncResult): void {
  ctx.out(`Sync: ${describeSync(result)}`);
  for (const file of result.resolved) ctx.out(`  kept upstream: ${file}`);
  for (const file of result.merged ?? []) ctx.out(`  merged both sides: ${file}`);
  if (result.branch) ctx.out(`  conflict branch: ${result.branch}`);
}

export function registerSync(program: Command, ctx: CliContext): void {
  program.command('sync')
    .description('sync the shared brain with GitHub: generated files never block, conflicts go to a branch')
    .option('--status', 'show the last sync, remote, scheduler and open conflict branches')
    .option('--install', 'run the sync on a schedule (systemd user timer, macOS LaunchAgent or Windows Task Scheduler)')
    .option('--uninstall', 'remove the scheduled sync')
    .option('--minutes <n>', 'schedule interval with --install', '5')
    .option('--cloud', 'cloud sandbox: keep usage counters and Obsidian bases local')
    .option('--host <name>', 'machine label in commit messages and conflict branches')
    .option('--vault <dir>', 'vault repository (default: the repository holding ~/.edu/brain)')
    .option('--reason <why>', 'what triggered the sync (timer, start, stop...)', 'manual')
    .option('--json', 'machine-readable output')
    .action(action<SyncOpts>(ctx, async ({ g, opts }) => {
      const eduHome = globalHome(ctx);
      const json = g.json || opts.json;
      const cloud = Boolean(opts.cloud) || ctx.env.EDU_SYNC_CLOUD === '1';
      if (opts.status) {
        const status = await syncStatus(ctx, opts.vault);
        if (json) return printJson(ctx, status);
        const last = status.last ?? undefined;
        ctx.out(`Sync: ${describeSync(last)}`);
        if (last?.branch) ctx.out(`Conflict branch: ${last.branch}`);
        ctx.out(`Remote: ${status.remote ?? 'none'}`);
        ctx.out(`Scheduler: ${status.scheduler.installed ? `${status.scheduler.kind} (installed)` : 'not installed'}`);
        ctx.out(`Open sync-conflict branches: ${status.conflictBranches.length}${status.conflictBranches.length ? ` (${status.conflictBranches.join(', ')})` : ''}`);
        if (!last || ALERT.has(last.state)) ctx.setExitCode(1);
        return;
      }
      if (opts.uninstall) {
        const result = await uninstallSchedule({ home: userHome(ctx), eduHome });
        if (json) return printJson(ctx, result);
        ctx.out(result.removed.length ? `Removed the scheduled sync (${result.kind}): ${result.removed.join(', ')}` : `No scheduled sync files found (${result.kind}).`);
        return;
      }
      if (opts.install) {
        const minutes = parseMinutes(opts.minutes);
        const result = await scheduleSync(ctx, { minutes, cloud });
        if (json) return printJson(ctx, result);
        ctx.out(`Scheduled sync (${result.kind}, every ${minutes} min): ${result.files.join(', ')}`);
        if (!result.started) ctx.err('The schedule files are written but could not be started; start them by hand.');
        ctx.out('Remove any older hand-made sync job (for example edu-vault-sync.timer) so only this one runs.');
        return;
      }
      const result = await syncBrain({ eduHome, vault: opts.vault, host: opts.host, cloud, reason: opts.reason, env: ctx.env });
      const previous = await writeSyncState(eduHome, result);
      // Alert once per new problem, not every five minutes.
      if (!cloud && ALERT.has(result.state) && (previous?.state !== result.state || previous?.branch !== result.branch)) {
        await notify(result.state === 'conflict' ? 'Edu: conflicto de sincronización' : 'Edu: el sync falló', result.message);
      }
      if (json) return printJson(ctx, result);
      printSync(ctx, result);
      if (ALERT.has(result.state)) ctx.setExitCode(1);
    }));
}
