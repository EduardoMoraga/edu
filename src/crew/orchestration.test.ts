import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EduEvent, Engine } from '../core/contracts.js';
import { createCrew } from './index.js';
import { runOrchestration } from './orchestration.js';
import type { CrewStore } from './store.js';
import { saveChecks } from '../evidence/registry.js';
import { engineCapabilities } from '../engine/autonomy.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function fakeEngine(): Engine {
  return { cli: 'claude', capabilities: engineCapabilities('claude'), available: async () => true, async *run(request, agentId) {
    const text = request.prompt.includes('Create a safe') ? JSON.stringify({
      requirements: [{ id: 'R-1', text: 'Command passes' }],
      checks: [{ id: 'pass', requirementIds: ['R-1'], command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 10000 }],
      steps: [],
    }) : '{"verdict":"pass","issues":[]}';
    yield { type: 'agent.text', agentId, text, at: new Date().toISOString() } satisfies EduEvent;
    yield { type: 'agent.end', agentId, ok: true, summary: text, at: new Date().toISOString() } satisfies EduEvent;
  } };
}

const passCheck = { id: 'pass', requirementIds: ['R-1'], command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 10000 };

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'edu-orchestration-'));
  roots.push(cwd);
  const brainRoot = join(cwd, '.edu');
  await mkdir(brainRoot);
  // The person's global home lives outside the workspace (and outside the real ~/.edu).
  const globalRoot = await mkdtemp(join(tmpdir(), 'edu-orchestration-home-'));
  roots.push(globalRoot);
  const crew = createCrew({ brainRoot, globalRoot, workspaceRoot: cwd, engineFactory: () => fakeEngine(), detectClis: async () => ['claude'],
    startHeadless: async job => job, sleep: async () => new Promise(resolve => setTimeout(resolve, 2)) });
  return { crew, cwd, brainRoot, globalRoot };
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
  it('records the failure when writing the final status fails, instead of escaping its own error handling', async () => {
    const { crew, cwd, brainRoot, globalRoot } = await setup();
    await saveChecks(cwd, [passCheck]);
    const queued = await crew.orchestrate({ goal: 'Finish while the disk fails once', cwd, autoApprove: true });
    let failures = 0;
    const store: CrewStore = { ...crew.store, update: async (id, patch) => {
      if (patch.endedAt && failures++ === 0) throw new Error('disk full');
      return crew.store.update(id, patch);
    } };
    const result = await runOrchestration(queued, { brainRoot, globalRoot, policy: { maxAutonomy: 'auto', passthrough: [], approvals: 'ask-on-write' }, store, engineFactory: () => fakeEngine(), detectClis: async () => ['claude'], sleep: async () => undefined });
    expect(result.status).toBe('failed');
    expect(result.summary).toBe('disk full');
    expect((await crew.store.events(queued.id)).some(event => event.type === 'error' && event.message === 'disk full')).toBe(true);
  });

  it('auto-approves the detached spec (edu run --detach --yes) and runs registered checks', async () => {
    const { crew, cwd } = await setup();
    await saveChecks(cwd, [passCheck]);
    const job = await crew.orchestrate({ goal: 'Check automatically', cwd, autoApprove: true });
    const result = await crew.runWorker(job.id);
    expect(result.status).toBe('done');
    expect(result.outcome).toBe('autonomous_verified_success');
    expect((await crew.store.events(job.id)).some(event => event.type === 'agent.status' && event.status === 'awaiting-approval')).toBe(false);
  });

  it('never auto-runs a planner-proposed check under --yes unless --allow-unregistered-checks is given', async () => {
    const { crew, cwd } = await setup();
    const skipped = await crew.runWorker((await crew.orchestrate({ goal: 'Check automatically', cwd, autoApprove: true })).id);
    expect(skipped.status).toBe('done');
    expect(skipped.outcome).toBe('unverified_success');
    expect((await crew.store.events(skipped.id)).some(event => event.type === 'verify.result')).toBe(false);
    const allowed = await crew.runWorker((await crew.orchestrate({ goal: 'Check automatically', cwd, autoApprove: true, allowUnregisteredChecks: true })).id);
    expect(allowed.outcome).toBe('autonomous_verified_success');
    expect(allowed.verificationSummary).toBe('1 passed, 0 failed');
  });

  it('pauses on a spec, resumes from a one-shot decision, and records outcome evidence', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const worker = crew.runWorker(job.id);
    const paused = await awaiting(crew, job.id);
    expect(paused.specPath.replace(/\\/g, '/')).toContain('/specs/');
    expect(paused.approval).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), title: 'Approve spec', unregisteredChecks: ['node -e "process.exit(0)"'] });
    await crew.approve(job.id, true, { by: 'cli', requestId: paused.approval!.requestId });
    const result = await worker;
    expect(result.status).toBe('done');
    expect(result.approval).toBeUndefined();
    expect(result.outcome).toBe('assisted_verified_success');
    expect(result.verificationSummary).toContain('passed');
    const events = await crew.store.events(job.id);
    expect(events.some(event => event.type === 'spec.ready')).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval.resolve', approved: true, by: 'cli' }));
  });

  it('publishes the spec path together with the awaiting-approval status', async () => {
    const { crew, cwd } = await setup();
    const patches: Array<Record<string, unknown>> = [];
    const update = crew.store.update.bind(crew.store);
    vi.spyOn(crew.store, 'update').mockImplementation(async (id, patch) => { patches.push({ ...patch }); return update(id, patch); });
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const worker = crew.runWorker(job.id);
    await awaiting(crew, job.id);
    expect(patches.find(patch => 'specPath' in patch)).toMatchObject({ status: 'awaiting-approval', approval: { title: 'Approve spec' } });
    await crew.approve(job.id, true, { by: 'deck' });
    expect((await worker).status).toBe('done');
  });

  it('stops without running checks when the spec is rejected', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Reject the command', cwd });
    const worker = crew.runWorker(job.id);
    await awaiting(crew, job.id);
    await crew.approve(job.id, false, { by: 'cli' });
    const result = await worker;
    expect(result.status).toBe('failed');
    expect(result.summary).toBe('spec rejected');
    expect((await crew.store.events(job.id)).some(event => event.type === 'verify.result')).toBe(false);
  });

  it('ignores decision files that do not name the open gate, including ones written before it opened', async () => {
    const { crew, cwd, brainRoot } = await setup();
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const decisionFile = join(brainRoot, 'crew', `${job.id}.decision`);
    // Written ahead of the gate: the legacy bare word, and a well-formed decision with a guessed id.
    await writeFile(decisionFile, 'approve');
    const worker = crew.runWorker(job.id);
    const paused = await awaiting(crew, job.id);
    await expect(readFile(decisionFile, 'utf8')).rejects.toThrow(); // cleared when the gate opened
    await writeFile(decisionFile, JSON.stringify({ requestId: 'guessed', approve: true, by: 'cli', at: new Date().toISOString() }));
    expect(await crew.store.takeDecision(job.id)).toBeUndefined();
    // An early timestamp with the right id is refused too.
    await writeFile(decisionFile, JSON.stringify({ requestId: paused.approval!.requestId, approve: true, by: 'cli', at: '2000-01-01T00:00:00.000Z' }));
    expect(await crew.store.takeDecision(job.id)).toBeUndefined();
    expect((await crew.status(job.id) as typeof paused).status).toBe('awaiting-approval');
    await expect(crew.approve(job.id, true, { by: 'cli', requestId: 'stale-request' })).rejects.toThrow('is not the one');
    await crew.approve(job.id, false, { by: 'cli', requestId: paused.approval!.requestId });
    expect((await worker).summary).toBe('spec rejected');
  });

  it('hands one decision to exactly one taker, even when takers race and the file is read while being written', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const gate = await crew.store.openApproval(job.id, { title: 'Approve spec' });
    await crew.approve(job.id, true, { by: 'cli', requestId: gate.approval!.requestId });
    const takes = await Promise.all(Array.from({ length: 8 }, () => crew.store.takeDecision(job.id)));
    expect(takes.filter(Boolean)).toEqual([{ approve: true, by: 'cli' }]);
    expect((await crew.status(job.id) as typeof gate).status).toBe('running');
  });

  it('refuses every approval from inside a crew worker', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const worker = crew.runWorker(job.id);
    const paused = await awaiting(crew, job.id);
    for (const env of [{ EDU_CREW_JOB: 'job-1' }, { ALBERT_CREW_JOB: 'job-1' }]) {
      await expect(crew.approve(job.id, true, { by: 'cli', requestId: paused.approval!.requestId, env })).rejects.toThrow('crew worker cannot approve');
    }
    expect((await crew.status(job.id) as typeof paused).status).toBe('awaiting-approval');
    await crew.approve(job.id, false, { by: 'cli' });
    await worker;
  });

  it('records a host LLM approval honestly and never lets it authorize unregistered checks', async () => {
    const { crew, cwd } = await setup();
    const job = await crew.orchestrate({ goal: 'Check the command', cwd });
    const worker = crew.runWorker(job.id);
    const paused = await awaiting(crew, job.id);
    await crew.approve(job.id, true, { by: 'host-llm', requestId: paused.approval!.requestId });
    const result = await worker;
    expect(result.status).toBe('done');
    // Not a person (not "assisted"), and the planner's own shell command never ran.
    expect(result.outcome).toBe('unverified_success');
    const events = await crew.store.events(job.id);
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval.resolve', approved: true, by: 'host-llm' }));
    expect(events.some(event => event.type === 'verify.result' || event.type === 'intervention')).toBe(false);
  });
});
