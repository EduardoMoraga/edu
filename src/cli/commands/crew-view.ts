/**
 * What `edu crew dispatch|status|cancel` print for people. Machines pass `--json` and get the job record. Job text
 * (tasks, summaries, notes, check commands) comes from agents and workspaces, so every line is printed with its
 * control and bidi characters removed: it cannot move the cursor, recolor the terminal or fake another line.
 */
import { cleanTitle } from '../../brain/clean-text.js';
import type { CrewJob } from '../../core/contracts.js';

const short = (id: string) => id.slice(0, 8);
/**
 * A command exactly as it will run, with control and bidi characters shown as \\uXXXX: a hidden newline, carriage
 * return or right-to-left override cannot make a second command look like part of the first.
 */
const visible = (command: string) => command.replace(/[\u0000-\u001f\u007f-\u009f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
const clip = (text: string, max: number) => { const line = cleanTitle(text); return line.length > max ? `${line.slice(0, max - 1)}…` : line; };
/** Up to `max` cleaned lines of a multi-line text, saying how many were left out. */
const lines = (text: string, max: number) => {
  const all = text.split(/\r?\n/).map(cleanTitle).filter(Boolean);
  return [...all.slice(0, max), ...(all.length > max ? [`… ${all.length - max} more line(s)`] : [])];
};

function age(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  return minutes < 60 ? `${minutes}m` : minutes < 48 * 60 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

/** The one line `edu crew dispatch` ends with (the TUI's /dispatch shows the last line). */
export function dispatchedView(job: CrewJob): string[] {
  const how = [job.cli, job.mode, `autonomy ${job.autonomy}`, ...(job.timeoutMinutes ? [`timeout ${job.timeoutMinutes} min`] : [])].join(', ');
  return [...(job.note ? [clip(job.note, 200)] : []), `Dispatched ${short(job.id)} (${how}). Follow it with: edu crew status ${short(job.id)}`];
}

export function cancelledView(job: CrewJob): string[] {
  const head = job.status === 'cancelled' ? `Cancelled ${short(job.id)}.` : `${short(job.id)} had already ended: ${job.status}.`;
  return [head, ...(job.note ? [clip(job.note, 200)] : [])];
}

/** One row per job, newest first. */
export function jobsView(jobs: CrewJob[], now: number): string[] {
  if (!jobs.length) return ['No crew jobs yet. Dispatch one with: edu crew dispatch <cli> "<task>"'];
  return [
    'ID        STATUS             CLI       AGE   TASK',
    ...jobs.map(job => `${short(job.id).padEnd(9)} ${job.status.padEnd(18)} ${`${job.cli}${job.kind === 'orchestration' ? '*' : ''}`.padEnd(9)} ${age(job.createdAt, now).padEnd(5)} ${clip(job.goal ?? job.task, 60)}`),
    ...(jobs.some(job => job.kind === 'orchestration') ? ['* an orchestration (edu run --detach, edu_orchestrate)'] : []),
    ...(jobs.some(job => job.status === 'awaiting-approval') ? ['A job awaiting approval shows its gate and commands with: edu crew status <id>'] : []),
  ];
}

/** One job in full: what it is, where it stands, and the open gate with every command it would authorize. */
export function jobView(job: CrewJob, now: number): string[] {
  const out = [
    `${short(job.id)}  ${job.status}  (${job.id})`,
    `${job.kind === 'orchestration' ? 'Orchestration' : 'Task'} on ${job.cli}, ${job.mode}, autonomy ${job.autonomy}${job.timeoutMinutes ? `, timeout ${job.timeoutMinutes} min` : ''}`,
    `Started ${age(job.createdAt, now)} ago${job.endedAt ? `, ended ${age(job.endedAt, now)} ago` : ''}`,
    `Task: ${clip(job.goal ?? job.task, 300)}`,
  ];
  if (job.outcome) out.push(`Outcome: ${job.outcome}${job.verificationSummary ? ` (${cleanTitle(job.verificationSummary)})` : ''}`);
  if (job.specPath) out.push(`Spec: ${cleanTitle(job.specPath)}`);
  if (job.summary) out.push('Summary:', ...lines(job.summary, 12).map(line => `  ${line}`));
  if (job.note && job.note !== job.specPath) out.push(`Note: ${clip(job.note, 300)}`);
  if (job.status === 'awaiting-approval' && job.approval) {
    const gate = job.approval;
    out.push('', `Waiting for: ${cleanTitle(gate.title)} (request ${gate.requestId})`);
    if (gate.unregisteredChecks?.length) {
      out.push('Approving runs these exact commands through the shell:', ...gate.unregisteredChecks.map(command => `  $ ${visible(command)}`));
    }
    out.push(`Decide: edu crew approve ${short(job.id)} --request ${gate.requestId}   (or: edu crew reject …)`);
  }
  return out;
}
