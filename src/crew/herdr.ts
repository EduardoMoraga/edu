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
  try {
    if (!await herdrAvailable(options)) throw new Error('Herdr pane mode requires HERDR_ENV=1 and herdr on PATH');
    const split = parse((await runner(['pane', 'split', '--current', '--direction', 'right', '--cwd', job.cwd, '--no-focus'])).stdout);
    const result = split.result as Record<string, unknown> | undefined;
    const pane = result?.pane as Record<string, unknown> | undefined;
    const paneId = pane?.pane_id;
    if (typeof paneId !== 'string' || !paneId) throw new Error('Herdr pane split did not return result.pane.pane_id');
    const agentName = `edu-${job.id.slice(0, 8)}`;
    const autonomyPrompt = job.autonomy === 'readonly'
      ? 'Autonomy policy: readonly. Do not modify files or take other write actions.'
      : `Autonomy policy: ${job.autonomy}. Follow this level for all requested actions.`;
    await runner(['agent', 'start', agentName, '--kind', job.cli, '--pane', paneId]);
    await runner(['agent', 'prompt', agentName, `${autonomyPrompt}\n\nMission: ${job.task}`]);
    return store.update(job.id, { status: 'running', paneId, agentName, note: undefined });
  } catch (error) {
    return store.update(job.id, { status: 'failed', endedAt: now().toISOString(), summary: errorMessage(error) });
  }
}

export async function refreshPane(job: CrewJob, options: HerdrOptions & { brainRoot?: string } = {}): Promise<CrewJob> {
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled' || !job.agentName) return job;
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ''}/.edu`);
  try {
    const raw = parse((await (options.runner ?? defaultRunner)(['agent', 'get', job.agentName])).stdout);
    const result = raw.result as Record<string, unknown> | undefined;
    const agent = result?.agent as Record<string, unknown> | undefined;
    const status = String(agent?.status ?? agent?.state ?? result?.status ?? raw.status ?? '').toLowerCase();
    if (status === 'done' || status === 'idle') {
      const output = await (options.runner ?? defaultRunner)(['agent', 'read', job.agentName, '--source', 'recent-unwrapped', '--lines', '200']);
      return store.update(job.id, { status: 'done', endedAt: (options.now ?? (() => new Date()))().toISOString(), summary: readResult(output.stdout) });
    }
    if (status === 'failed' || status === 'error') return store.update(job.id, { status: 'failed', endedAt: (options.now ?? (() => new Date()))().toISOString(), summary: `Herdr agent ${status}` });
    return job;
  } catch (error) {
    return store.update(job.id, { status: 'failed', endedAt: (options.now ?? (() => new Date()))().toISOString(), summary: errorMessage(error) });
  }
}
