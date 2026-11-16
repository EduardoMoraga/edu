import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CrewJob } from '../../core/contracts.js';
import { createCrewStore } from '../../crew/store.js';
import { captureContext, out, runCli } from '../../test-support/cli.js';
import { dispatchedView } from './crew-view.js';

describe('edu crew output', () => {
  it('lists jobs for people and keeps the records for --json', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const store = createCrewStore(root, { globalRoot: captured.dirs.eduHome });
    await runCli(captured, ['crew', 'status']);
    expect(out(captured)).toContain('No crew jobs yet');
    const job = await store.create({ cli: 'codex', task: 'Write tests\u001b[2J for auth', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'auto' });
    captured.stdout.length = 0;
    await runCli(captured, ['crew', 'status']);
    const table = out(captured);
    expect(table).toMatch(new RegExp(`^ID +STATUS +CLI +AGE +TASK\\n${job.id.slice(0, 8)} +queued +codex +0m +Write tests \\[2J for auth$`));
    expect(table).not.toContain('\u001b');
    captured.stdout.length = 0;
    await runCli(captured, ['crew', 'status', '--json']);
    expect(JSON.parse(out(captured))).toEqual([expect.objectContaining({ id: job.id, status: 'queued' })]);
  });

  it('shows one job with its open gate, its request id and every command exactly, control characters made visible', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const store = createCrewStore(root, { globalRoot: captured.dirs.eduHome });
    const job = await store.create({ cli: 'claude', task: 'Goal', goal: 'Ship the fix', kind: 'orchestration', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'auto' });
    const gated = await store.openApproval(job.id, { title: 'Approve spec', unregisteredChecks: ['npm test', 'npm run lint\nrm -rf ~'] });
    const requestId = gated.approval!.requestId;
    await runCli(captured, ['crew', 'status', job.id.slice(0, 8)]);
    const view = out(captured);
    expect(view).toContain('awaiting-approval');
    expect(view).toContain('Task: Ship the fix');
    expect(view).toContain(`Waiting for: Approve spec (request ${requestId})`);
    expect(view).toContain('  $ npm test\n  $ npm run lint\\u000arm -rf ~');
    expect(view).toContain(`edu crew approve ${job.id.slice(0, 8)} --request ${requestId}`);
    captured.stdout.length = 0;
    await runCli(captured, ['crew', 'status', job.id, '--json']);
    expect(JSON.parse(out(captured))).toMatchObject({ id: job.id, approval: { requestId } });
  });

  it('ends a dispatch with one line that names the job and how to follow it', () => {
    const job = { id: '4f2a1b2c-0000-4000-8000-000000000000', cli: 'codex', mode: 'headless', autonomy: 'auto', timeoutMinutes: 60, note: 'Herdr unavailable (herdr is not on PATH); dispatched as headless.' } as CrewJob;
    expect(dispatchedView(job)).toEqual([
      'Herdr unavailable (herdr is not on PATH); dispatched as headless.',
      'Dispatched 4f2a1b2c (codex, headless, autonomy auto, timeout 60 min). Follow it with: edu crew status 4f2a1b2c',
    ]);
  });
});
