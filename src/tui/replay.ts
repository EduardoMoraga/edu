/**
 * Replay of persisted runs (`runs/<id>.jsonl`). Parsing is pure; timing lives
 * in a separate async iterator with an injectable sleep so it is testable.
 *
 * The contracts do not ship a runtime schema for EduEvent, so validation here
 * is structural: known `type`, string `at`, and the required fields per type.
 */
import { readFile } from 'node:fs/promises';
import type { EduEvent } from '../core/contracts.js';

type FieldKind = 'string' | 'number' | 'boolean' | 'object' | 'array';

const REQUIRED: Record<EduEvent['type'], Record<string, FieldKind>> = {
  'run.start': { runId: 'string', goal: 'string', mode: 'string' },
  'run.end': { runId: 'string', ok: 'boolean', summary: 'string' },
  'agent.spawn': { agentId: 'string', role: 'string', cli: 'string', task: 'string' },
  'agent.status': { agentId: 'string', status: 'string' },
  'agent.text': { agentId: 'string', text: 'string' },
  'agent.thinking': { agentId: 'string', text: 'string' },
  'tool.call': { agentId: 'string', callId: 'string', tool: 'string', input: 'string' },
  'tool.result': { agentId: 'string', callId: 'string', ok: 'boolean', output: 'string' },
  usage: { agentId: 'string', usage: 'object' },
  'context.usage': { usedTokens: 'number', windowTokens: 'number' },
  'approval.request': { agentId: 'string', approvalId: 'string', title: 'string', detail: 'string' },
  'approval.resolve': { approvalId: 'string', approved: 'boolean', by: 'string' },
  'brain.recall': { noteIds: 'array' },
  'brain.learn': { noteId: 'string', kind: 'string', title: 'string' },
  'agent.end': { agentId: 'string', ok: 'boolean', summary: 'string' },
  error: { message: 'string' },
};

export interface ParseIssue {
  line: number;
  message: string;
}

export interface ParsedRun {
  events: EduEvent[];
  issues: ParseIssue[];
}

/** Returns a reason the value is not an EduEvent, or undefined when it is. */
export function eventProblem(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not an object';
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || !(v.type in REQUIRED)) return `unknown event type ${JSON.stringify(v.type)}`;
  if (typeof v.at !== 'string' || Number.isNaN(Date.parse(v.at))) return `${v.type}: missing or invalid "at"`;
  for (const [field, kind] of Object.entries(REQUIRED[v.type as EduEvent['type']])) {
    const f = v[field];
    const ok =
      kind === 'array' ? Array.isArray(f) : kind === 'object' ? typeof f === 'object' && f !== null : typeof f === kind;
    if (!ok) return `${v.type}: field "${field}" must be ${kind}`;
  }
  return undefined;
}

export function isEduEvent(value: unknown): value is EduEvent {
  return eventProblem(value) === undefined;
}

/** Parses JSONL text. Blank lines are skipped; invalid lines become issues, never guesses. */
export function parseRunJsonl(text: string): ParsedRun {
  const events: EduEvent[] = [];
  const issues: ParseIssue[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      issues.push({ line: i + 1, message: 'invalid JSON' });
      return;
    }
    const problem = eventProblem(value);
    if (problem) issues.push({ line: i + 1, message: problem });
    else events.push(value as EduEvent);
  });
  return { events, issues };
}

export async function loadRun(path: string): Promise<ParsedRun> {
  return parseRunJsonl(await readFile(path, 'utf8'));
}

export interface TimingOptions {
  /** Playback speed: 2 = twice as fast. Defaults to 1. */
  speed?: number;
  /** Caps any single wait (ms) so idle gaps do not stall playback. */
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Yields events spaced by their original `at` deltas divided by `speed`. */
export async function* timedEvents(events: readonly EduEvent[], opts: TimingOptions = {}): AsyncGenerator<EduEvent> {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const sleep = opts.sleep ?? defaultSleep;
  let prev: number | undefined;
  for (const event of events) {
    if (opts.signal?.aborted) return;
    const t = Date.parse(event.at);
    if (prev !== undefined && !Number.isNaN(t)) {
      let wait = Math.max(0, (t - prev) / speed);
      if (opts.maxDelayMs !== undefined) wait = Math.min(wait, opts.maxDelayMs);
      if (wait > 0) await sleep(wait, opts.signal);
      if (opts.signal?.aborted) return;
    }
    if (!Number.isNaN(t)) prev = t;
    yield event;
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
