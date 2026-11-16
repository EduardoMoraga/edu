import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCrewStore } from '../../crew/store.js';
import { captureContext, err, runCli } from '../../test-support/cli.js';
import { encodeWorkerPolicy } from '../../workspace/config.js';

describe('edu crew worker and dispatch policy', () => {
  it('runs the job in EDU_CREW_BRAIN under the policy its dispatcher handed down, with EDU_HOME left as the global home', async () => {
    const captured = await captureContext();
    const brainRoot = join(captured.dirs.cwd, '.edu');
    await mkdir(brainRoot);
    const store = createCrewStore(brainRoot, { globalRoot: captured.dirs.eduHome });
    const job = await store.create({ cli: 'codex', task: 'Fix the test', mode: 'headless', cwd: captured.dirs.cwd, autonomy: 'ask' });
    // A digest that does not match the record: the worker must find the job through EDU_CREW_BRAIN and refuse it.
    captured.ctx.env = { ...captured.ctx.env, EDU_CREW_BRAIN: brainRoot, EDU_CREW_POLICY: encodeWorkerPolicy({ maxAutonomy: 'auto', passthrough: [], approvals: 'ask-on-write', job: '0'.repeat(64) }) };
    await runCli(captured, ['crew', 'worker', job.id]);
    expect(err(captured)).toBe('');
    expect(await store.get(job.id)).toMatchObject({ status: 'failed', summary: expect.stringContaining('changed after dispatch') });
  });

  it('refuses a terminal dispatch above the global crew.maxAutonomy, whatever the project config says', async () => {
    const captured = await captureContext();
    await mkdir(join(captured.dirs.cwd, '.edu'));
    await writeFile(join(captured.dirs.cwd, '.edu', 'config.json'), JSON.stringify({ crew: { maxAutonomy: 'full' } }));
    await runCli(captured, ['crew', 'dispatch', 'codex', 'Delete everything', '--autonomy', 'full']);
    expect(captured.exitCode).toBe(1);
    expect(err(captured)).toContain('crew.maxAutonomy');
    expect(await createCrewStore(join(captured.dirs.cwd, '.edu'), { globalRoot: captured.dirs.eduHome }).list()).toEqual([]);
  });
});
