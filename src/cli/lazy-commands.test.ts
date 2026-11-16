import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

// Records the first import of each heavy module. Every `edu` call (including the session-start hook)
// builds the whole command tree, so bench, eval and experiment must load only when they run.
const { loaded, track } = vi.hoisted(() => {
  const loaded: string[] = [];
  const track = (name: string) => async (importOriginal: () => Promise<unknown>) => { loaded.push(name); return importOriginal(); };
  return { loaded, track };
});
vi.mock('../bench/activation.js', track('bench/activation') as never);
vi.mock('../bench/context.js', track('bench/context') as never);
vi.mock('../bench/retrieval.js', track('bench/retrieval') as never);
vi.mock('../bench/fixtures/corpus.js', track('bench/corpus') as never);
vi.mock('../eval/index.js', track('eval') as never);
vi.mock('../experiment/run.js', track('experiment') as never);

import { captureContext, out, runCli } from './testkit.js';

it('loads bench, eval and experiment code only when that command runs', async () => {
  const c = await captureContext();
  try {
    await runCli(c, ['--version']);
    for (const help of [['bench'], ['eval', 'aggregate'], ['eval', 'suite'], ['experiment', 'inspect'], ['experiment', 'run']]) {
      expect((await runCli(c, [...help, '--help']))?.code).toBe('commander.helpDisplayed');
    }
    await runCli(c, ['brain', 'status']);
    expect(loaded).toEqual([]);

    await runCli(c, ['bench', 'activation']);
    expect(out(c)).toContain('Edu');
    expect(loaded).toEqual(['bench/activation']);

    const trials = join(c.dirs.cwd, 'trials.json');
    await writeFile(trials, '[]');
    await runCli(c, ['eval', 'aggregate', trials, '--json']);
    expect(c.exitCode).toBeUndefined();
    expect(loaded).toContain('eval');
    expect(loaded).not.toContain('bench/corpus');
    expect(loaded).not.toContain('experiment');
  } finally { await rm(join(c.dirs.cwd, '..'), { recursive: true, force: true }); }
});
