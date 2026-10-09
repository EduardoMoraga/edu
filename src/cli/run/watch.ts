/**
 * `edu watch` drivers: the live crew view (TTY) and a plain job listing or
 * event dump (pipes, CI). Jobs are read through a CrewSource so the store
 * implementation can change without touching the view.
 */
import type { EduEvent } from '../../core/contracts.js';
import { getGlyphs } from '../../identity/index.js';
import type { CrewSource } from '../../tui/crew.js';
import type { CliContext } from '../context.js';
import { t, type Lang } from '../i18n.js';
import { createPlainFormatter } from './plain.js';
import { createCommandHandler, type CommandDeps } from './commands.js';

export interface WatchSetup {
  source: CrewSource;
  jobId?: string;
  lang: Lang;
  /** Interface language for the TUI (may follow the locale). */
  uiLang: Lang;
  name: string;
  pollMs: number;
  brain?: CommandDeps['brain'];
  /** Starts a crew job for `/dispatch`; omitted = the palette reports it unavailable. */
  dispatch?: (cli: string, task: string) => Promise<string>;
}

/** Mounts the mission-control view; resolves when the user quits. */
export async function watchInTui(setup: WatchSetup): Promise<void> {
  const [{ renderTui }, { watchCrew }] = await Promise.all([import('../../tui/index.js'), import('../../tui/crew.js')]);
  const abort = new AbortController();
  const app = renderTui({
    events: watchCrew(setup.source, { jobId: setup.jobId, pollMs: setup.pollMs, signal: abort.signal }),
    name: setup.name,
    lang: setup.uiLang,
    crew: true,
    onCommand: createCommandHandler({ lang: setup.lang, brain: setup.brain, crew: { list: () => setup.source.list(), dispatch: setup.dispatch } }),
  });
  try {
    await app.waitUntilExit();
  } finally {
    abort.abort();
  }
}

/** Non-TTY: one line per job, or the events of one job, then exit. */
export async function watchPlain(ctx: CliContext, setup: Pick<WatchSetup, 'source' | 'jobId' | 'lang'>): Promise<void> {
  const jobs = (await setup.source.list()).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  if (!setup.jobId) {
    if (!jobs.length) return ctx.out(t(setup.lang, 'watch.none'));
    for (const job of jobs) ctx.out(`${job.status.padEnd(9)} ${job.id.slice(0, 8)}  ${job.cli.padEnd(8)} ${job.task.replace(/\s+/g, ' ')}`);
    return;
  }
  const { watchCrew } = await import('../../tui/crew.js');
  const format = createPlainFormatter(getGlyphs(ctx.env));
  const events: EduEvent[] = [];
  for await (const event of watchCrew(setup.source, { jobId: setup.jobId, follow: false })) events.push(event);
  for (const event of events) {
    if (event.type === 'error') {
      ctx.err(t(setup.lang, 'error.prefix', { message: event.message }));
      ctx.setExitCode(1);
      continue;
    }
    const line = format(event);
    if (line) ctx.out(line);
  }
}
