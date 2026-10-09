/**
 * Host side of the live view's `/` palette: the commands the TUI cannot run
 * by itself (`/brain`, `/recall`, and in watch mode `/status`, `/dispatch`).
 * Results come back as one-line notices.
 */
import { execFile } from 'node:child_process';
import type { RecallHit } from '../../core/contracts.js';
import type { CrewJobInfo } from '../../tui/crew.js';
import type { CommandHandler } from '../../tui/index.js';
import { t, type Lang } from '../i18n.js';
import { lessonCount } from '../workspace.js';

export interface CommandDeps {
  lang: Lang;
  brain?: {
    stats(): Promise<{ total: number; byStatus: Record<string, number> }>;
    recall(query: string, opts?: { limit?: number }): Promise<RecallHit[]>;
  };
  crew?: {
    list(): Promise<CrewJobInfo[]>;
    /** Starts a job; resolves with a short confirmation (e.g. the job id). */
    dispatch?(cli: string, task: string): Promise<string>;
  };
}

const RECALL_LIMIT = 5;

export function createCommandHandler(deps: CommandDeps): CommandHandler {
  const { lang } = deps;
  return async (name, args) => {
    switch (name) {
      case 'brain': {
        if (!deps.brain) return undefined;
        const stats = await deps.brain.stats();
        return t(lang, 'tui.brainStats', { total: stats.total, lessons: lessonCount(stats.byStatus) });
      }
      case 'recall': {
        if (!deps.brain) return undefined;
        const hits = await deps.brain.recall(args, { limit: RECALL_LIMIT });
        if (!hits.length) return t(lang, 'tui.recallNone', { query: args });
        return t(lang, 'tui.recallHits', { count: hits.length, titles: hits.map((h) => h.note.meta.title).join(' · ') });
      }
      case 'status': {
        if (!deps.crew) return undefined;
        const jobs = await deps.crew.list();
        if (!jobs.length) return t(lang, 'tui.crewNone');
        const counts = new Map<string, number>();
        for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
        const summary = [...counts].map(([status, n]) => `${n} ${status}`).join(' · ');
        return t(lang, 'tui.crewStatus', { count: jobs.length, summary });
      }
      case 'dispatch': {
        if (!deps.crew?.dispatch) return undefined;
        const match = /^(\S+)\s+([\s\S]+)$/.exec(args.trim());
        if (!match) return t(lang, 'tui.dispatchUsage');
        const output = await deps.crew.dispatch(match[1]!, match[2]!.trim());
        return t(lang, 'tui.dispatched', { output });
      }
      default:
        return undefined;
    }
  };
}

export type CliRunner = (args: string[]) => Promise<string>;

/** Runs this same `edu` binary with `args` and resolves with its trimmed stdout. */
export function selfRunner(entry = process.argv[1]): CliRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      if (!entry) return reject(new Error('cannot locate the edu entry point'));
      execFile(process.execPath, [entry, ...args], { timeout: 30_000 }, (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim().split('\n').at(-1) ?? error.message));
        else resolve(stdout.trim().split('\n').at(-1) ?? '');
      });
    });
}

/** `/dispatch <cli> <task>` through the public `edu crew dispatch` command (no coupling to src/crew internals). */
export function cliDispatch(run: CliRunner, cwd: string): (cli: string, task: string) => Promise<string> {
  return (cli, task) => run(['--cwd', cwd, 'crew', 'dispatch', cli, task]);
}
