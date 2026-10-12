import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EduEvent, Engine } from '../core/contracts.js';
import { createCrew } from './index.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function fakeEngine(): Engine {
  return { cli: 'claude', available: async () => true, async *run(request, agentId) {
    const text = request.prompt.includes('Create a safe') ? JSON.stringify({
      requirements: [{ id: 'R-1', text: 'Command passes' }],
      checks: [{ id: 'pass', requirementIds: ['R-1'], command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 10000 }],
      steps: [],
    }) : '{"verdict":"pass","issues":[]}';
    yield { type: 'agent.text', agentId, text, at: new Date().toISOString() } satisfies EduEvent;
    yield { type: 'agent.end', agentId, ok: true, summary: text, at: new Date().toISOString() } satisfies EduEvent;
  } };
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'edu-orchestration-'));
  roots.push(cwd);
  const brainRoot = join(cwd, '.edu');
  await mkdir(brainRoot);
  const crew = createCrew({ brainRoot, workspaceRoot: cwd, engineFactory: () => fakeEngine(), detectClis: async () => ['claude'],
    startHeadless: async job => job, sleep: async () => new Promise(resolve => setTimeout(resolve, 2)) });
  return { crew, cwd };
}

async function awaiting(crew: Awaited<ReturnType<typeof setup>>['crew'], id: string) {
  // A deadline, not an iteration count: Windows timers tick at ~15 ms and a loaded runner plans slower.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const job = await crew.status(id);
    if (!Array.isArray(job) && job.status === 'awaiting-approval') return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Job did not reach awaiting-approval');
}

describe('detached orchestration', () => {
  it('auto-approves the detached spec without entering a paused state', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Check automatically', cwd, autoApprove: true });
    const result = await crew.runWorker(job.id);
    expect(result.status).toBe('done');
    expect(result.outcome).toBe('autonomous_verified_success');
    expect((await crew.store.events(job.id)).some(event => event.type === 'agent.status' && event.status === 'awaiting-approval')).toBe(false);
  });

  it('pauses on a spec, resumes from a one-shot decision, and records outcome evidence', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const worker = crew.runWorker(job.id);
    const paused = await awaiting(crew, job.id);
    expect(paused.specPath.replace(/\\/g, '/')).toContain('/specs/');
    await crew.approve(job.id, true);
    const result = await worker;
    expect(result.status).toBe('done');
    expect(result.outcome).toBe('assisted_verified_success');
    expect(result.verificationSummary).toContain('passed');
    expect((await crew.store.events(job.id)).some(event => event.type === 'spec.ready')).toBe(true);
  });

  it('publishes the spec path together with the awaiting-approval status', async () => {
    const { crew, cwd } = await setup();
    const patches: Array<Record<string, unknown>> = [];
    const update = crew.store.update.bind(crew.store);
    vi.spyOn(crew.store, 'update').mockImplementation(async (id, patch) => { patches.push({ ...patch }); return update(id, patch); });
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const worker = crew.runWorker(job.id);
    await awaiting(crew, job.id);
    expect(patches.find(patch => 'specPath' in patch)).toMatchObject({ status: 'awaiting-approval' });
    await crew.approve(job.id, true);
    expect((await worker).status).toBe('done');
  });

  it('stops without running checks when the spec is rejected', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Reject the command', cwd });
    const worker = crew.runWorker(job.id);
    await awaiting(crew, job.id);
    await crew.approve(job.id, false);
    const result = await worker;
    expect(result.status).toBe('failed');
    expect(result.summary).toBe('spec rejected');
    expect((await crew.store.events(job.id)).some(event => event.type === 'verify.result')).toBe(false);
  });
});
