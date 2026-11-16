/** Crew job tools: dispatch a job to a coding CLI, follow it and page its output. */
import { z } from 'zod';
import { estimateTokens } from '../../context/index.js';
import type { Autonomy } from '../../core/contracts.js';
import { loadCrewPolicy, withinAutonomy } from '../../workspace/config.js';
import { eduHomeOf } from '../projects.js';
import type { ToolContext } from './context.js';
import { autonomyLevels, cliIds, optionalInt, optionalNumber, tokenLimit } from './schema.js';

/** edu_crew_result waits at most this long per call; poll again for longer jobs. */
export const MAX_RESULT_WAIT_SECONDS = 600;

export function registerCrewTools(ctx: ToolContext): void {
  const { register, env } = ctx;

  register('edu_crew_dispatch', 'Run a crew job on a coding CLI. mode pane: visible herdr pane, headless if herdr is unreachable', {
    cli: cliIds, task: z.string().min(1), mode: z.enum(['headless', 'pane']).optional(), cwd: z.string().optional(), autonomy: autonomyLevels.optional(),
    timeoutMinutes: optionalInt(1, 1440, 'Stop a headless job after this many minutes (default: crew.timeoutMinutes, else 60)'),
    maxTokens: tokenLimit,
  }, async ({ cli, task, mode, cwd, autonomy: selectedAutonomy, timeoutMinutes }) => {
    // The ceiling comes from the global config only: a person raises it, never a workspace or the caller.
    const { maxAutonomy } = await loadCrewPolicy(eduHomeOf(env));
    const requested: Autonomy = selectedAutonomy ?? 'ask';
    if (!withinAutonomy(requested, maxAutonomy)) throw new Error(`Autonomy "${requested}" is above the crew ceiling "${maxAutonomy}". A person can raise crew.maxAutonomy in the global Edu config, or run edu crew dispatch from a terminal.`);
    const job = await ctx.crew.dispatch({ cli, task, mode, cwd, autonomy: requested, ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}) });
    return JSON.stringify(job);
  });

  register('edu_crew_status', 'List crew jobs or show one', {
    jobId: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ jobId }) => JSON.stringify(await ctx.crew.status(jobId)));

  register('edu_crew_result', 'Wait for and read a crew job result', {
    jobId: z.string().min(1), waitSeconds: optionalNumber(0, MAX_RESULT_WAIT_SECONDS, `Seconds to wait, at most ${MAX_RESULT_WAIT_SECONDS}`), maxTokens: tokenLimit,
  }, async ({ jobId, waitSeconds }) => JSON.stringify(await ctx.crew.result(jobId, waitSeconds ?? 0)));

  register('edu_crew_artifact', 'Page a crew job\'s sanitized output or summary; continue with nextOffset until null', {
    jobId: z.string().min(1), kind: z.enum(['output', 'summary']), offset: optionalInt(0),
    maxBytes: optionalInt(1, 4096), maxTokens: optionalInt(100, 20000),
  }, async ({ jobId, kind, offset, maxBytes, maxTokens }) => {
    const limit = maxTokens ?? 800;
    let pageBytes = Math.min(maxBytes ?? 1000, 4096);
    while (true) {
      const page = JSON.stringify(await ctx.crew.store.artifact(jobId, kind, offset, pageBytes));
      if (estimateTokens(page) <= limit) return page;
      if (pageBytes <= 4) throw new Error('Artifact page metadata exceeds maxTokens');
      pageBytes = Math.max(4, Math.floor(pageBytes / 2));
    }
  });

  // Destructive, so a crew worker is refused before this runs (see TOOL_ANNOTATIONS): workers never stop other jobs.
  register('edu_crew_cancel', 'Cancel a crew job: stop its worker (or close its pane) and mark it cancelled; a finished job is returned unchanged', {
    jobId: z.string().min(1), maxTokens: tokenLimit,
  }, async ({ jobId }) => JSON.stringify(await ctx.crew.cancel(jobId)));
}
