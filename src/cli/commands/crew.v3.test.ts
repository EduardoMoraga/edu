import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCrewStore } from '../../crew/store.js';
import { captureContext, out, runCli } from '../testkit.js';

describe('edu crew approval commands', () => {
  it('writes a one-shot decision for a paused orchestration', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'claude', task: 'Goal', goal: 'Goal', kind: 'orchestration', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'auto' });
    await store.update(job.id, { status: 'awaiting-approval' });
    await runCli(captured, ['crew', 'approve', job.id]);
    expect(out(captured)).toContain(job.id);
    expect(await readFile(join(root, 'crew', `${job.id}.decision`), 'utf8')).toBe('approve');
  });

  it('writes rejection for a paused orchestration', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'claude', task: 'Goal', goal: 'Goal', kind: 'orchestration', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'auto' });
    await store.update(job.id, { status: 'awaiting-approval' });
    await runCli(captured, ['crew', 'reject', job.id]);
    expect(await readFile(join(root, 'crew', `${job.id}.decision`), 'utf8')).toBe('reject');
  });

  it('finds detached jobs in the global brain when the project has no local brain', async () => {
    const captured = await captureContext();
    const root = captured.dirs.eduHome;
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'claude', task: 'Goal', goal: 'Goal', kind: 'orchestration', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'auto' });
    await store.update(job.id, { status: 'awaiting-approval' });
    await runCli(captured, ['crew', 'approve', job.id]);
    expect(await readFile(join(root, 'crew', `${job.id}.decision`), 'utf8')).toBe('approve');
  });
});
