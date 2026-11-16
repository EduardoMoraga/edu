import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { binaryOnPath } from '../platform/index.js';
import type { CrewJob } from '../core/contracts.js';
import { interactiveAutonomyFlags } from '../engine/autonomy.js';
import { isTerminalCrewJobStatus } from './status.js';
import { createCrewStore, type CrewStore } from './store.js';

const execFile = promisify(execFileCallback);
export interface HerdrResult { stdout: string; stderr: string }
export type HerdrRunner = (args: string[]) => Promise<HerdrResult>;
export interface HerdrOptions {
  runner?: HerdrRunner; store?: CrewStore; env?: NodeJS.ProcessEnv; hasBinary?: () => Promise<boolean>; now?: () => Date;
  /** Waits between retries of a failed herdr call (tests inject an instant one). */
  sleep?: (ms: number) => Promise<void>;
}

/** A herdr call that fails this many times in a row fails the job; one failure may be a restarting server. */
const HERDR_ATTEMPTS = 3;
const HERDR_RETRY_MS = 250;

const defaultRunner: HerdrRunner = async args => {
  const result = await execFile('herdr', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
};
const parse = (text: string): Record<string, unknown> => {
  try { const value: unknown = JSON.parse(text); if (value && typeof value === 'object') return value as Record<string, unknown>; }
  catch { /* Produce a bounded, clear error below. */ }
  throw new Error('Herdr returned invalid JSON');
};
function errorMessage(error: unknown): string { return `Herdr error: ${error instanceof Error ? error.message : String(error)}`; }
function readResult(text: string): string {
  try {
    const parsed = parse(text);
    const result = parsed.result as Record<string, unknown> | undefined;
    const value = result?.text ?? result?.output ?? result?.content ?? parsed.text ?? parsed.output;
    return typeof value === 'string' ? value.trim() : JSON.stringify(value ?? parsed);
  } catch {
    return text.trim();
  }
}

/** The herdr workspace that receives crew panes dispatched from outside herdr (e.g. Hermes on Telegram). */
export const EDU_WORKSPACE_LABEL = 'Edu';

/**
 * Where a pane job can go. `inside`: the caller runs in a herdr pane (HERDR_ENV=1), so split next to
 * it. `outside`: the caller is not in herdr but the herdr CLI reaches a running server over its
 * socket (default ~/.config/herdr/herdr.sock, or HERDR_SOCKET_PATH); the job gets a new tab in the
 * "Edu" workspace, or a new "Edu" workspace. `none`: fall back to headless.
 */
export type HerdrTarget = { kind: 'inside' } | { kind: 'outside'; workspaceId?: string } | { kind: 'none'; reason: string };

export async function herdrTarget(options: HerdrOptions = {}): Promise<HerdrTarget> {
  const env = options.env ?? process.env;
  if (!await (options.hasBinary ?? (() => binaryOnPath('herdr')))()) return { kind: 'none', reason: 'herdr is not on PATH' };
  if (env.HERDR_ENV === '1') return { kind: 'inside' };
  let list: Record<string, unknown>;
  try { list = parse((await (options.runner ?? defaultRunner)(['workspace', 'list'])).stdout); }
  catch { return { kind: 'none', reason: 'no herdr server is reachable from here' }; }
  const workspaces = ((list.result as Record<string, unknown> | undefined)?.workspaces ?? []) as Array<Record<string, unknown>>;
  const edu = Array.isArray(workspaces) ? workspaces.find(w => typeof w.label === 'string' && w.label.trim().toLowerCase() === EDU_WORKSPACE_LABEL.toLowerCase()) : undefined;
  return { kind: 'outside', workspaceId: typeof edu?.workspace_id === 'string' ? edu.workspace_id : undefined };
}

/**
 * Opens the pane for a job and returns its id: a split beside the caller, or a tab in the Edu workspace.
 *
 * The pane carries `EDU_CREW_JOB=<job id>`, the marker a headless worker's CLI gets (engine/process.ts): the agent
 * CLI started in the pane's shell inherits it, so its Edu MCP server runs in worker mode and the agent can never
 * approve a gate, dispatch agents or write memory. A person typing in that pane is treated as the worker too.
 *
 * Environment limit: unlike headless agents (platform/child-env.ts), a pane agent cannot get the allowlisted
 * environment. herdr (0.9) starts the pane's interactive shell from the herdr server's environment, the shell's rc
 * files run, and `herdr agent start` launches the CLI's own executable in that shell, with no wrapper such as
 * `env -i`. The `--env KEY=VALUE` of `pane split`, `tab create` and `workspace create` only adds variables. Typing
 * `env -i … <cli>` through `herdr pane run` instead would lose herdr's readiness and trust-prompt handling, depend on
 * the user's shell syntax (fish lists), and put values on a command line. So a pane agent sees the same environment
 * as a CLI the user starts in that terminal, plus the worker marker; dispatch headless when it must not.
 */
async function openPane(job: CrewJob, target: Exclude<HerdrTarget, { kind: 'none' }>, runner: HerdrRunner, agentName: string): Promise<string | undefined> {
  const worker = ['--env', `EDU_CREW_JOB=${job.id}`];
  if (target.kind === 'inside') {
    const split = parse((await runner(['pane', 'split', '--current', '--direction', 'right', '--cwd', job.cwd, ...worker, '--no-focus'])).stdout);
    const pane = (split.result as Record<string, unknown> | undefined)?.pane as Record<string, unknown> | undefined;
    return typeof pane?.pane_id === 'string' ? pane.pane_id : undefined;
  }
  const args = target.workspaceId
    ? ['tab', 'create', '--workspace', target.workspaceId, '--cwd', job.cwd, '--label', agentName, ...worker, '--no-focus']
    : ['workspace', 'create', '--cwd', job.cwd, '--label', EDU_WORKSPACE_LABEL, ...worker, '--no-focus'];
  const created = parse((await runner(args)).stdout).result as Record<string, unknown> | undefined;
  const pane = (created?.root_pane ?? created?.pane) as Record<string, unknown> | undefined;
  return typeof pane?.pane_id === 'string' ? pane.pane_id : undefined;
}

export async function dispatchPane(job: CrewJob, options: HerdrOptions & { brainRoot?: string; target?: HerdrTarget } = {}): Promise<CrewJob> {
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ''}/.edu`);
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => new Date());
  let paneId: string | undefined;
  let agentStarted = false;
  try {
    const target = options.target ?? await herdrTarget(options);
    if (target.kind === 'none') throw new Error(`Herdr pane mode unavailable: ${target.reason}`);
    const agentName = `edu-${job.id.slice(0, 8)}`;
    paneId = await openPane(job, target, runner, agentName);
    if (typeof paneId !== 'string' || !paneId) throw new Error(target.kind === 'inside' ? 'Herdr pane split did not return result.pane.pane_id' : 'Herdr did not return result.root_pane.pane_id');
    const where = target.kind === 'outside' ? `Visible in herdr workspace "${EDU_WORKSPACE_LABEL}", pane ${paneId}.` : undefined;
    // Autonomy reaches the CLI as its own permission flags, which it enforces, not as a sentence it may ignore.
    // Interactive Codex can refuse its shared background server; --no-daemon runs it standalone.
    const cliArgs = [...interactiveAutonomyFlags(job.cli, job.autonomy), ...(job.cli === 'codex' ? ['--no-daemon'] : [])];
    const agentArgs = cliArgs.length ? ['--', ...cliArgs] : [];
    const prompt = job.task;
    try {
      await runner(['agent', 'start', agentName, '--kind', job.cli, '--pane', paneId, ...agentArgs]);
      agentStarted = true;
    } catch (error) {
      // The CLI is up but asking the human something (folder trust, sign-in). That is the user's call:
      // keep the job alive, point them to the pane, and deliver the prompt once the agent is ready.
      if (!/agent_not_ready/.test(errorMessage(error))) throw error;
      agentStarted = true;
      const question = await lastPaneLines(paneId, options).catch(() => '');
      return await store.update(job.id, {
        status: 'running', paneId, agentName, pendingPrompt: prompt,
        note: `${job.cli} is waiting for your answer in herdr pane ${paneId}. Answer it there; Edu sends the task as soon as it is ready.${question ? `\n${question}` : ''}`,
      });
    }
    await sendPrompt(runner, agentName, prompt);
    return await store.update(job.id, { status: 'running', paneId, agentName, note: where, ...await promptBaseline(agentName, paneId, options, now) });
  } catch (error) {
    let summary = errorMessage(error);
    if (paneId && !agentStarted) {
      try { await runner(['pane', 'close', paneId]); }
      catch (cleanupError) { summary += `; pane cleanup failed: ${errorMessage(cleanupError)}`; }
    }
    return store.update(job.id, { status: 'failed', endedAt: now().toISOString(), summary });
  }
}

/** `--` keeps a task that starts with `-` from being read as a herdr option. */
function sendPrompt(runner: HerdrRunner, agentName: string, prompt: string): Promise<HerdrResult> {
  return runner(['agent', 'prompt', agentName, '--', prompt]);
}

/** herdr errors that mean the agent or pane no longer exists: retrying cannot help. */
const GONE = /not[_ ]found|no such (?:agent|pane)|unknown (?:agent|pane)/i;

export async function refreshPane(job: CrewJob, options: HerdrOptions & { brainRoot?: string } = {}): Promise<CrewJob> {
  if (isTerminalCrewJobStatus(job.status) || !job.agentName) return job;
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ''}/.edu`);
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  let lastError: unknown;
  for (let attempt = 1; attempt <= HERDR_ATTEMPTS; attempt++) {
    try { return await refreshOnce(job, store, options); }
    catch (error) {
      lastError = error;
      if (GONE.test(errorMessage(error)) || attempt === HERDR_ATTEMPTS) break;
      await sleep(HERDR_RETRY_MS * attempt);
    }
  }
  // The agent is gone (crashed or exited) or herdr kept failing: surface what the pane last showed.
  const paneTail = job.paneId ? await lastPaneLines(job.paneId, options).catch(() => '') : '';
  const summary = paneTail ? `Agent exited. Last pane output:\n${paneTail}` : errorMessage(lastError);
  return store.update(job.id, { status: 'failed', endedAt: now().toISOString(), summary });
}

async function refreshOnce(job: CrewJob, store: CrewStore, options: HerdrOptions): Promise<CrewJob> {
  const agentName = job.agentName!;
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => new Date());
  const { status, seq } = await agentState(agentName, options);
  if (job.pendingPrompt) {
    if (status !== 'idle' && status !== 'done') return job;
    // Claim the prompt under the job lock, so two pollers never both send it.
    let claimed: string | undefined;
    const current = await store.mutate(job.id, latest => {
      if (!latest.pendingPrompt || isTerminalCrewJobStatus(latest.status)) return undefined;
      claimed = latest.pendingPrompt;
      return { pendingPrompt: undefined, note: undefined };
    });
    if (claimed === undefined) return current;
    try { await sendPrompt(runner, agentName, claimed); }
    catch (error) {
      await store.mutate(job.id, latest => latest.pendingPrompt || isTerminalCrewJobStatus(latest.status) ? undefined : { pendingPrompt: claimed });
      throw error;
    }
    return store.update(job.id, await promptBaseline(agentName, job.paneId, options, now));
  }
  if (status === 'working' || status === 'blocked') {
    await appendPaneOutput(job, store, options);
    return job.observedWorking ? job : store.update(job.id, { observedWorking: true });
  }
  // A finished state counts only for a turn that began after Edu's prompt: herdr can still say `done` (or
  // `idle`) about an earlier turn, or before the agent picked the prompt up. Evidence: herdr was seen working,
  // its state sequence moved past the prompt's, or (when herdr reports neither) the pane text changed.
  let changedSincePrompt = seq !== undefined && job.promptSeq !== undefined && seq > job.promptSeq;
  const settledFor = job.promptedAt ? now().getTime() - Date.parse(job.promptedAt) : 0;
  if (!changedSincePrompt && (status === 'idle' || status === 'done') && job.paneId && job.promptPaneHash && settledFor >= 5000) {
    changedSincePrompt = (await paneHash(job.paneId, options).catch(() => job.promptPaneHash)) !== job.promptPaneHash;
  }
  if ((status === 'done' || status === 'idle') && (job.observedWorking || changedSincePrompt)) {
    await appendPaneOutput(job, store, options);
    const output = await runner(['agent', 'read', agentName, '--source', 'recent-unwrapped', '--lines', '200']);
    // A screen identical to the one right after the prompt holds no answer, whatever text it shows.
    const unchanged = job.promptPaneHash !== undefined && createHash('sha256').update(output.stdout).digest('hex') === job.promptPaneHash;
    const answer = unchanged ? undefined : paneAnswer(readResult(output.stdout), job.task);
    return store.update(job.id, { status: 'done', endedAt: now().toISOString(), summary: answer ?? unreadableAnswer(job) });
  }
  if (status === 'failed' || status === 'error') {
    await appendPaneOutput(job, store, options);
    return store.update(job.id, { status: 'failed', endedAt: now().toISOString(), summary: `Herdr agent ${status}` });
  }
  return job;
}

/** A column-0 user-input marker: a CLI's echo of a submitted prompt or its composer (Claude Code `>`, Codex `›`). */
const INPUT_MARKER = /^(?:[│┃]\s*)?[>›❯](?:\s|$)/;
/** How Claude Code and Codex echo a long bracketed paste instead of its text. */
const PASTED = /\[Pasted (?:text|content)\b[^\]]*\]/i;
/** Blank lines and lines drawn only with box and rule characters. */
const CHROME = /^[\s─━│┃║═╭╮╰╯┌┐└┘├┤┬┴┼╔╗╚╝]*$/;
const squash = (text: string) => text.replace(/[│┃║]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The agent's answer on a pane screen: what follows the echoed prompt, without the composer the CLI draws below
 * it. Undefined when nothing follows the prompt: the CLI drew its answer on the terminal's alternate screen, whose
 * rows never reach herdr's scrollback, or the turn left nothing readable. A screen scrape, so best effort: when the
 * prompt is no longer on screen, everything above the composer counts as the answer.
 */
export function paneAnswer(screen: string, prompt: string): string | undefined {
  const lines = screen.replace(/\r/g, '').split('\n').map(line => line.trimEnd());
  const echo = echoEnd(lines, prompt);
  let start = echo === undefined ? 0 : echo + 1;
  let end = lines.length;
  for (let index = end - 1; index >= start; index--) if (INPUT_MARKER.test(lines[index]!)) { end = index; break; }
  while (start < end && CHROME.test(lines[start]!)) start++;
  while (end > start && CHROME.test(lines[end - 1]!)) end--;
  return lines.slice(start, end).join('\n').trim() || undefined;
}

/** The line where the echoed prompt ends: its text (wrapped and indented by the CLI), or a pasted-text placeholder. */
function echoEnd(lines: string[], prompt: string): number | undefined {
  const offsets: number[] = [];
  let joined = '';
  for (const line of lines) { offsets.push(joined.length); joined += `${squash(line)} `; }
  const lineAt = (offset: number) => { let index = 0; while (index + 1 < offsets.length && offsets[index + 1]! <= offset) index++; return index; };
  // The tail is enough to find the end of a long prompt; a short one is matched whole, preferably on a marker line.
  const needle = squash(prompt).slice(-48);
  if (needle) {
    let first: number | undefined;
    for (let at = joined.indexOf(needle); at !== -1; at = joined.indexOf(needle, at + 1)) {
      first ??= at;
      if (INPUT_MARKER.test(lines[lineAt(at)]!)) return lineAt(at + needle.length - 1);
    }
    if (first !== undefined) return lineAt(first + needle.length - 1);
  }
  const pasted = lines.findIndex(line => INPUT_MARKER.test(line) && PASTED.test(line));
  return pasted === -1 ? undefined : pasted;
}

function unreadableAnswer(job: CrewJob): string {
  return `The agent finished, but its answer could not be read from herdr pane ${job.paneId ?? job.agentName}: nothing after the prompt is on the screen herdr returns. The CLI likely drew it on the terminal's alternate screen, whose rows never reach herdr's scrollback. Read the answer in the pane.`;
}

/** Closes a job's pane (cancel): the agent in it stops with it. */
export async function closePane(job: CrewJob, options: HerdrOptions & { brainRoot?: string } = {}): Promise<void> {
  if (!job.paneId) return;
  await (options.runner ?? defaultRunner)(['pane', 'close', job.paneId]);
}

async function appendPaneOutput(job: CrewJob, store: CrewStore, options: HerdrOptions): Promise<void> {
  if (!job.paneId) return;
  const text = await lastPaneLines(job.paneId, options).catch(() => '');
  if (!text) return;
  // Event text is deliberately replaced with an artifact pointer in the store.
  // Compare the latest pane snapshot in memory instead of reading raw event text.
  if (lastPaneSnapshots.get(job.id) === text) return;
  await store.appendEvent(job.id, { type: 'agent.text', agentId: job.id, text, at: (options.now ?? (() => new Date()))().toISOString() });
  lastPaneSnapshots.set(job.id, text);
}

const lastPaneSnapshots = new Map<string, string>();

async function agentState(name: string, options: HerdrOptions): Promise<{ status: string; seq?: number }> {
  const raw = parse((await (options.runner ?? defaultRunner)(['agent', 'get', name])).stdout);
  const result = raw.result as Record<string, unknown> | undefined;
  const agent = result?.agent as Record<string, unknown> | undefined;
  const reported = [agent?.agent_status, agent?.status, agent?.state, result?.agent_status, result?.status, raw.status].find(value => value !== undefined && value !== null);
  const status = (typeof reported === 'string' ? reported : '').toLowerCase();
  const seq = typeof agent?.state_change_seq === 'number' ? agent.state_change_seq : undefined;
  return { status, seq };
}

async function paneHash(paneId: string, options: HerdrOptions): Promise<string> {
  const output = await (options.runner ?? defaultRunner)(['pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', '200']);
  return createHash('sha256').update(output.stdout).digest('hex');
}

/** Captured right after a prompt is delivered, to tell later "answered" from "not started yet". */
async function promptBaseline(name: string, paneId: string | undefined, options: HerdrOptions, now: () => Date) {
  const state = await agentState(name, options).catch(() => undefined);
  const hash = paneId ? await paneHash(paneId, options).catch(() => undefined) : undefined;
  return { promptSeq: state?.seq, promptPaneHash: hash, promptedAt: now().toISOString() };
}

async function lastPaneLines(paneId: string, options: HerdrOptions): Promise<string> {
  const output = await (options.runner ?? defaultRunner)(['pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', '12']);
  return output.stdout.trim().split('\n').slice(-8).join('\n');
}
