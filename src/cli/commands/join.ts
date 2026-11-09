/** `edu join <repo>`: attach this machine or a cloud sandbox to the shared brain in one command. */
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { globalHome, type CliContext } from '../context.js';
import { action, printJson } from '../kit.js';
import { joinBrain } from '../../vault/join.js';
import { writeSyncState } from '../../vault/sync.js';
import type { ScheduleResult } from '../../vault/sync-service.js';
import { parseMinutes, printSync, scheduleSync } from './sync.js';

interface JoinOpts { path?: string; subdir?: string; branch?: string; cloud?: boolean; install?: boolean; minutes?: string; host?: string; json?: boolean }

const ALERT = new Set(['conflict', 'error']);

const SAID: Record<string, string> = {
  cloned: 'cloned the shared brain',
  merged: 'merged this brain with the shared brain',
  imported: 'brought this brain into a clone of the shared brain',
  'already-joined': 'already joined; synced',
};

export function registerJoin(program: Command, ctx: CliContext): void {
  program.command('join')
    .description('attach this machine or a cloud sandbox to the shared brain repository (clone or merge, then sync)')
    .argument('<repo-url>', 'Git URL of the brain repository; credentials come from Git or GH_TOKEN')
    .option('--path <dir>', 'where the repository lives (default ~/.edu/brain, or ~/.edu/vault with --subdir)')
    .option('--subdir <dir>', 'folder inside the repository that holds the brain (for example 01-CONOCIMIENTO)')
    .option('--branch <name>', 'branch to follow', 'main')
    .option('--cloud', 'cloud sandbox: keep usage counters and Obsidian bases local')
    .option('--install', 'also schedule `edu sync`')
    .option('--minutes <n>', 'schedule interval with --install', '5')
    .option('--host <name>', 'machine label in commits, conflict branches and kept local copies')
    .option('--json', 'machine-readable output')
    .action(action<JoinOpts>(ctx, async ({ g, opts }, url) => {
      const eduHome = globalHome(ctx);
      const minutes = opts.install ? parseMinutes(opts.minutes) : 5;
      const cloud = Boolean(opts.cloud) || ctx.env.EDU_SYNC_CLOUD === '1';
      const report = await joinBrain({
        url: url!, eduHome, path: opts.path ? resolve(g.cwd, opts.path) : undefined, subdir: opts.subdir,
        branch: opts.branch, cloud, host: opts.host, env: ctx.env,
      });
      if (report.sync) await writeSyncState(eduHome, report.sync);
      let schedule: ScheduleResult | undefined;
      let scheduleError: string | undefined;
      if (opts.install) {
        try { schedule = await scheduleSync(ctx, { minutes, cloud }); } catch (error) { scheduleError = (error as Error).message; }
      }
      const failed = (report.sync && ALERT.has(report.sync.state)) || scheduleError !== undefined;
      if (failed) ctx.setExitCode(1);
      if (g.json || opts.json) return printJson(ctx, { ...report, schedule, scheduleError });
      ctx.out(`Joined ${report.remote} (${report.branch}): ${SAID[report.action]}`);
      ctx.out(`  repository: ${report.repo}`);
      ctx.out(`  brain: ${report.brain}${report.brain !== report.link ? ` (linked from ${report.link})` : ''}`);
      if (report.added.length) ctx.out(`  from this machine: ${report.added.length} file(s) added to the shared brain`);
      for (const kept of report.keptBoth) ctx.out(`  kept both: ${kept.path} (this machine's version: ${kept.local})`);
      if (report.keptBoth.length) ctx.out('  Review the .local-* copies and merge or delete them; nothing was discarded.');
      if (report.backup) ctx.out(`  previous brain folder kept at: ${report.backup}`);
      for (const line of report.setup) ctx.out(`  setup: ${line}`);
      if (report.sync) printSync(ctx, report.sync);
      if (schedule) {
        ctx.out(`Scheduled sync (${schedule.kind}, every ${minutes} min): ${schedule.files.join(', ')}`);
        if (!schedule.started) ctx.err('The schedule files are written but could not be started; start them by hand.');
      }
      if (scheduleError) ctx.err(`Scheduling failed: ${scheduleError}`);
    }));
}
