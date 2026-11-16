import type { CrewJobStatus } from '../core/contracts.js';

/** Every crew job status. Readers import this list; none keeps its own copy. */
export const CREW_JOB_STATUSES = ['queued', 'running', 'awaiting-approval', 'done', 'failed', 'cancelled'] as const satisfies readonly CrewJobStatus[];

/**
 * A crew job's default limit in minutes, unless the job, the workspace config or the global config says otherwise: a
 * headless task's run, a pane job's life, a detached orchestration's working time and each of its gate waits.
 */
export const DEFAULT_CREW_TIMEOUT_MINUTES = 60;

/** Statuses a job never leaves. */
export const TERMINAL_CREW_JOB_STATUSES = ['done', 'failed', 'cancelled'] as const satisfies readonly CrewJobStatus[];

// Fails to compile when contracts.ts gains a status this list lacks.
type Missing = Exclude<CrewJobStatus, (typeof CREW_JOB_STATUSES)[number]>;
const complete: [Missing] extends [never] ? true : never = true;
void complete;

export function isCrewJobStatus(value: unknown): value is CrewJobStatus {
  return typeof value === 'string' && (CREW_JOB_STATUSES as readonly string[]).includes(value);
}

export function isTerminalCrewJobStatus(value: unknown): value is (typeof TERMINAL_CREW_JOB_STATUSES)[number] {
  return typeof value === 'string' && (TERMINAL_CREW_JOB_STATUSES as readonly string[]).includes(value);
}
