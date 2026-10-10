import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { binaryOnPath } from '../adapters/common.js';
import type { CrewJob } from '../core/contracts.js';
import { createCrewStore, type CrewStore } from './store.js';

const execFile = promisify(execFileCallback);
export interface HerdrResult { stdout: string; stderr: string }
export type HerdrRunner = (args: string[]) => Promise<HerdrResult>;
export interface HerdrOptions { runner?: HerdrRunner; store?: CrewStore; env?: NodeJS.ProcessEnv; hasBinary?: () => Promise<boolean>; now?: () => Date }

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

export async function herdrAvailable(options: HerdrOptions = {}): Promise<boolean> {
  return (options.env ?? process.env).HERDR_ENV === '1' && await (options.hasBinary ?? (() => binaryOnPath('herdr')))();
}

export async function dispatchPane(job: CrewJob, options: HerdrOptions & { brainRoot?: string } = {}): Promise<CrewJob> {
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ''}/.edu`);
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => new Date());
  let paneId: string | undefined;
  let agentStarted = false;
  try {
    if (!await herdrAvailable(options)) throw new Error('Herdr pane mode requires HERDR_ENV=1 and herdr on PATH');
    const split = parse((await runner(['pane', 'split', '--current', '--direction', 'right', '--cwd', job.cwd, '--no-focus'])).stdout);
    const result = split.result as Record<string, unknown> | undefined;
    const pane = result?.pane as Record<string, unknown> | undefined;
    paneId = typeof pane?.pane_id === 'string' ? pane.pane_id : undefined;
    if (typeof paneId !== 'string' || !paneId) throw new Error('Herdr pane split did not return result.pane.pane_id');
    const agentName = `edu-${job.id.slice(0, 8)}`;
    const autonomyPrompt = job.autonomy === 'readonly'
      ? 'Autonomy policy: readonly. Do not modify files or take other write actions.'
      : `Autonomy policy: ${job.autonomy}. Follow this level for all requested actions.`;
    // Interactive Codex can refuse its shared background server; --no-daemon runs it standalone.
    const agentArgs = job.cli === 'codex' ? ['--', '--no-daemon'] : [];
    const prompt = `${autonomyPrompt}\n\nMission: ${job.task}`;
    try {
      await runner(['agent', 'start', agentName, '--kind', job.cli, '--pane', paneId, ...agentArgs]);
      agentStarted = true;
    } catch (error) {
      // The CLI is up but asking the human something (folder trust, sign-in). That is the user's call:
      // keep the job alive, point them to the pane, and deliver the prompt once the agent is ready.
      if (!/agent_not_ready/.test(errorMessage(error))) throw error;
      agentStarted = true;
      const question = await lastPaneLines(paneId, options).catch(() => '');
      return store.update(job.id, {
        status: 'running', paneId, agentName, pendingPrompt: prompt,
        note: `${job.cli} is waiting for your answer in herdr pane ${paneId}. Answer it there; Edu sends the task as soon as it is ready.${question ? `\n${question}` : ''}`,
      });
    }
    await runner(['agent', 'prompt', agentName, prompt]);
    return store.update(job.id, { status: 'running', paneId, agentName, note: undefined, ...await promptBaseline(agentName, paneId, options, now) });
  } catch (error) {
    let summary = errorMessage(error);
    if (paneId && !agentStarted) {
      try { await runner(['pane', 'close', paneId]); }
      catch (cleanupError) { summary += `; pane cleanup failed: ${errorMessage(cleanupError)}`; }
    }
    return store.update(job.id, { status: 'failed', endedAt: now().toISOString(), summary });
  }
}

export async function refreshPane(job: CrewJob, options: HerdrOptions & { brainRoot?: string } = {}): Promise<CrewJob> {
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled' || !job.agentName) return job;
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ''}/.edu`);
  try {
    const { status, seq } = await agentState(job.agentName, options);
    if (job.pendingPrompt) {
      if (status !== 'idle' && status !== 'done') return job;
      await (options.runner ?? defaultRunner)(['agent', 'prompt', job.agentName, job.pendingPrompt]);
      return store.update(job.id, { pendingPrompt: undefined, note: undefined, ...await promptBaseline(job.agentName, job.paneId, options, options.now ?? (() => new Date())) });
    }
    if (status === 'working' || status === 'blocked') {
      await appendPaneOutput(job, store, options);
      return job.observedWorking ? job : store.update(job.id, { observedWorking: true });
    }
    // herdr reports `done` for a finished, unseen turn; `idle` alone may mean the prompt was not picked up yet.
    let changedSincePrompt = seq !== undefined && job.promptSeq !== undefined && seq > job.promptSeq;
    // Very short turns can finish without herdr ever reporting `working`; fall back to the pane text.
    const settledFor = job.promptedAt ? (options.now ?? (() => new Date()))().getTime() - Date.parse(job.promptedAt) : 0;
    if (!changedSincePrompt && status === 'idle' && job.paneId && job.promptPaneHash && settledFor >= 5000) {
      changedSincePrompt = (await paneHash(job.paneId, options).catch(() => job.promptPaneHash)) !== job.promptPaneHash;
    }
    if (status === 'done' || (status === 'idle' && (job.observedWorking || changedSincePrompt))) {
      await appendPaneOutput(job, store, options);
      const output = await (options.runner ?? defaultRunner)(['agent', 'read', job.agentName, '--source', 'recent-unwrapped', '--lines', '200']);
      return store.update(job.id, { status: 'done', endedAt: (options.now ?? (() => new Date()))().toISOString(), summary: readResult(output.stdout) });
    }
    if (status === 'failed' || status === 'error') {
      await appendPaneOutput(job, store, options);
      return store.update(job.id, { status: 'failed', endedAt: (options.now ?? (() => new Date()))().toISOString(), summary: `Herdr agent ${status}` });
    }
    return job;
  } catch (error) {
    // The agent is gone (crashed or exited): surface what the pane last showed instead of a bare lookup error.
    const paneTail = job.paneId ? await lastPaneLines(job.paneId, options).catch(() => '') : '';
    const summary = paneTail ? `Agent exited. Last pane output:\n${paneTail}` : errorMessage(error);
    return store.update(job.id, { status: 'failed', endedAt: (options.now ?? (() => new Date()))().toISOString(), summary });
  }
}

async function appendPaneOutput(job: CrewJob, store: CrewStore, options: HerdrOptions): Promise<void> {
  if (!job.paneId) return;
  const text = await lastPaneLines(job.paneId, options).catch(() => '');
  if (!text) return;
  const previous = (await store.events(job.id)).filter(event => event.type === 'agent.text').at(-1);
  if (previous?.type === 'agent.text' && previous.text === text) return;
  await store.appendEvent(job.id, { type: 'agent.text', agentId: job.id, text, at: (options.now ?? (() => new Date()))().toISOString() });
}

async function agentState(name: string, options: HerdrOptions): Promise<{ status: string; seq?: number }> {
  const raw = parse((await (options.runner ?? defaultRunner)(['agent', 'get', name])).stdout);
  const result = raw.result as Record<string, unknown> | undefined;
  const agent = result?.agent as Record<string, unknown> | undefined;
  const status = String(agent?.agent_status ?? agent?.status ?? agent?.state ?? result?.agent_status ?? result?.status ?? raw.status ?? '').toLowerCase();
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
