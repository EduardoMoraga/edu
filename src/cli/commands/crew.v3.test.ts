import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCrewStore } from '../../crew/store.js';
import { captureContext, err, out, runCli, type Captured } from '../testkit.js';

/** A paused orchestration in `root` with an open approval gate. */
async function paused(captured: Captured, root: string) {
  const store = createCrewStore(root);
  const job = await store.create({ cli: 'claude', task: 'Goal', goal: 'Goal', kind: 'orchestration', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'auto' });
  const gated = await store.openApproval(job.id, { title: 'Approve spec' });
  return { store, job, requestId: gated.approval!.requestId, decision: async () => JSON.parse(await readFile(join(root, 'crew', `${job.id}.decision`), 'utf8')) };
}

describe('edu crew approval commands', () => {
  it('writes a one-shot decision for the open gate, attributed to the CLI', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const gate = await paused(captured, root);
    await runCli(captured, ['crew', 'approve', gate.job.id]);
    expect(out(captured)).toContain(gate.job.id);
    expect(await gate.decision()).toMatchObject({ requestId: gate.requestId, approve: true, by: 'cli' });
    expect(await gate.store.takeDecision(gate.job.id)).toEqual({ approve: true, by: 'cli' });
  });

  it('writes a rejection naming the reviewed request, attributed to the Deck', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const gate = await paused(captured, root);
    await runCli(captured, ['crew', 'reject', gate.job.id.slice(0, 8), '--request', gate.requestId, '--via', 'deck']);
    expect(await gate.decision()).toMatchObject({ requestId: gate.requestId, approve: false, by: 'deck' });
  });

  it('refuses a request that is not the open gate, a forged channel, and any crew worker', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const gate = await paused(captured, root);
    await runCli(captured, ['crew', 'approve', gate.job.id, '--request', 'an-older-request']);
    expect(captured.exitCode).toBe(1);
    expect(err(captured)).toContain('is not the one');
    await runCli(captured, ['crew', 'approve', gate.job.id, '--via', 'host-llm']);
    expect(err(captured)).toContain('--via must be cli or deck');
    captured.ctx.env = { ...captured.ctx.env, EDU_CREW_JOB: 'worker-1' };
    await runCli(captured, ['crew', 'approve', gate.job.id, '--request', gate.requestId]);
    expect(err(captured)).toContain('crew worker cannot approve');
    await expect(readFile(join(root, 'crew', `${gate.job.id}.decision`), 'utf8')).rejects.toThrow();
  });

  it('finds detached jobs in the global brain when the project has no local brain', async () => {
    const captured = await captureContext();
    const root = captured.dirs.eduHome;
    const gate = await paused(captured, root);
    await runCli(captured, ['crew', 'approve', gate.job.id]);
    expect(await gate.decision()).toMatchObject({ requestId: gate.requestId, approve: true });
  });
});
