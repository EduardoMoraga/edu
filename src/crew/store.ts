import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Autonomy, CliId, CrewJob, CrewJobMode, CrewJobStatus, EduEvent } from '../core/contracts.js';

export interface NewCrewJob { cli: CliId; task: string; mode: CrewJobMode; cwd: string; autonomy: Autonomy }
export type CrewJobPatch = Partial<Pick<CrewJob, 'status' | 'pid' | 'paneId' | 'agentName' | 'endedAt' | 'pendingPrompt' | 'observedWorking' | 'promptSeq' | 'promptPaneHash' | 'promptedAt' | 'summary' | 'usage' | 'note'>>;

export interface CrewStore {
  create(input: NewCrewJob): Promise<CrewJob>;
  get(id: string): Promise<CrewJob | undefined>;
  list(): Promise<CrewJob[]>;
  update(id: string, patch: CrewJobPatch): Promise<CrewJob>;
  appendEvent(id: string, event: EduEvent): Promise<void>;
  events(id: string): Promise<EduEvent[]>;
}

const statuses = new Set<CrewJobStatus>(['queued', 'running', 'done', 'failed', 'cancelled']);
const safeId = (id: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`Invalid crew job id: ${id}`);
  return id;
};

export function createCrewStore(brainRoot: string): CrewStore {
  const root = join(brainRoot, 'crew');
  const metaPath = (id: string) => join(root, `${safeId(id)}.json`);
  const eventPath = (id: string) => join(root, `${safeId(id)}.jsonl`);
  const ensure = () => mkdir(root, { recursive: true });
  async function atomicJson(path: string, value: unknown): Promise<void> {
    await ensure();
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
      await rename(temporary, path);
    } catch (error) {
      const { unlink } = await import('node:fs/promises');
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  return {
    async create(input) {
      const now = new Date().toISOString();
      const job: CrewJob = { ...input, id: randomUUID(), status: 'queued', createdAt: now, summary: '', usage: { inputTokens: 0, outputTokens: 0 } };
      await atomicJson(metaPath(job.id), job);
      await writeFile(eventPath(job.id), '', { flag: 'wx' });
      return job;
    },
    async get(input) {
      // Accept a unique id prefix (as printed by `edu crew status`) as well as the full id.
      let id = input;
      if (/^[a-f0-9-]{4,35}$/i.test(input)) {
        const { readdir } = await import('node:fs/promises');
        const matches = (await readdir(root).catch(() => [] as string[])).filter(f => f.endsWith('.json') && f.startsWith(input.toLowerCase()));
        if (matches.length > 1) throw new Error(`Ambiguous crew job id prefix: ${input}`);
        if (matches.length === 0) return undefined;
        id = matches[0]!.slice(0, -'.json'.length);
      }
      try {
        const job: unknown = JSON.parse(await readFile(metaPath(id), 'utf8'));
        if (!job || typeof job !== 'object' || !('id' in job) || !('status' in job) || !statuses.has((job as CrewJob).status)) throw new Error(`Invalid crew job record: ${id}`);
        return job as CrewJob;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async list() {
      await ensure();
      const files = (await readdir(root)).filter(file => /^[a-f0-9-]{36}\.json$/i.test(file));
      const jobs = await Promise.all(files.map(file => this.get(file.slice(0, -5))));
      return jobs.filter((job): job is CrewJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async update(id, patch) {
      const current = await this.get(id);
      if (!current) throw new Error(`Crew job not found: ${id}`);
      if (patch.status && !statuses.has(patch.status)) throw new Error(`Invalid crew job status: ${patch.status}`);
      const updated = { ...current, ...patch };
      await atomicJson(metaPath(id), updated);
      return updated;
    },
    async appendEvent(id, event) {
      if (!await this.get(id)) throw new Error(`Crew job not found: ${id}`);
      await appendFile(eventPath(id), `${JSON.stringify(event)}\n`, 'utf8');
    },
    async events(id) {
      if (!await this.get(id)) throw new Error(`Crew job not found: ${id}`);
      const text = await readFile(eventPath(id), 'utf8');
      return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as EduEvent);
    },
  };
}
