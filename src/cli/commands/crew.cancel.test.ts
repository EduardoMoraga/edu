import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCrewStore } from '../../crew/store.js';
import { captureContext, err, out, runCli } from '../../test-support/cli.js';

describe('edu crew cancel and timeout', () => {
  it('cancels a job by id prefix and prints it', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'Long task', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'ask' });
    await runCli(captured, ['crew', 'cancel', job.id.slice(0, 8)]);
    expect(out(captured)).toBe(`Cancelled ${job.id.slice(0, 8)}.`);
    expect((await store.get(job.id))?.status).toBe('cancelled');
    // Scripts ask for the record.
    captured.stdout.length = 0;
    await runCli(captured, ['crew', 'cancel', job.id, '--json']);
    expect(JSON.parse(out(captured))).toMatchObject({ id: job.id, status: 'cancelled' });
  });

  it('rejects a timeout that is not a whole number of minutes before creating a job', async () => {
    const captured = await captureContext();
    const root = join(captured.dirs.cwd, '.edu');
    await mkdir(root);
    await runCli(captured, ['crew', 'dispatch', 'codex', 'Task', '--timeout', 'soon']);
    expect(err(captured)).toContain('whole number of minutes');
    expect(await createCrewStore(root).list()).toEqual([]);
  });
});
