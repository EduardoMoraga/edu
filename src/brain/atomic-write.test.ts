import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RENAME_BACKOFF_MS, atomicFs, atomicWrite } from './store.js';
import { openBrain } from './brain.js';

const locked = (code = 'EPERM') => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'edu-atomic-'));
  vi.spyOn(atomicFs, 'sleep').mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('atomicWrite on a target another process holds open', () => {
  it('retries the rename with backoff on EPERM/EBUSY/EACCES and then succeeds', async () => {
    const target = join(root, 'H-note.md');
    await writeFile(target, 'old');
    const realRename = atomicFs.rename;
    const rename = vi.spyOn(atomicFs, 'rename')
      .mockRejectedValueOnce(locked('EPERM'))
      .mockRejectedValueOnce(locked('EBUSY'))
      .mockRejectedValueOnce(locked('EACCES'))
      .mockImplementation(realRename);
    const copy = vi.spyOn(atomicFs, 'copyFile');

    await atomicWrite(target, 'new');

    expect(rename).toHaveBeenCalledTimes(4);
    expect(vi.mocked(atomicFs.sleep).mock.calls.map(([ms]) => ms)).toEqual(RENAME_BACKOFF_MS.slice(0, 3));
    expect(copy).not.toHaveBeenCalled();
    expect(await readFile(target, 'utf8')).toBe('new');
    expect(await readdir(root)).toEqual(['H-note.md']);
  });

  it('falls back to copying over the target when the rename never succeeds, leaving no temp file', async () => {
    const target = join(root, 'H-note.md');
    await writeFile(target, 'old');
    const rename = vi.spyOn(atomicFs, 'rename').mockRejectedValue(locked('EPERM'));

    await atomicWrite(target, 'new content');

    expect(rename).toHaveBeenCalledTimes(RENAME_BACKOFF_MS.length + 1);
    expect(RENAME_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(2000);
    expect(await readFile(target, 'utf8')).toBe('new content');
    expect(await readdir(root)).toEqual(['H-note.md']);
  });

  it('throws the lock error and cleans up when even the copy fails', async () => {
    const target = join(root, 'H-note.md');
    await writeFile(target, 'old');
    vi.spyOn(atomicFs, 'rename').mockRejectedValue(locked('EBUSY'));
    vi.spyOn(atomicFs, 'copyFile').mockRejectedValue(locked('EBUSY'));

    await expect(atomicWrite(target, 'new')).rejects.toMatchObject({ code: 'EBUSY' });
    expect(await readFile(target, 'utf8')).toBe('old');
    expect(await readdir(root)).toEqual(['H-note.md']);
  });

  it('does not retry errors that are not locks', async () => {
    vi.spyOn(atomicFs, 'rename').mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
    const copy = vi.spyOn(atomicFs, 'copyFile');
    await expect(atomicWrite(join(root, 'x.md'), 'x')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(atomicFs.sleep).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
});

describe('usage tracking on read paths', () => {
  it('rewrites a used note at most once per minute and keeps counting across minutes', async () => {
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Lock aware writes', body: 'obsidian holds file handles' });
    const writes = vi.spyOn(atomicFs, 'writeFile');

    const t0 = new Date('2026-10-08T10:00:05Z');
    await brain.recordUse([lesson.meta.id], t0);
    await brain.recordUse([lesson.meta.id], new Date('2026-10-08T10:00:50Z'));
    expect(writes).toHaveBeenCalledTimes(1);
    expect((await brain.read(lesson.meta.id))?.meta.usage).toMatchObject({ uses: 1, lastUsed: t0.toISOString() });

    await brain.recordUse([lesson.meta.id], new Date('2026-10-08T10:01:00Z'));
    expect((await brain.read(lesson.meta.id))?.meta.usage).toMatchObject({ uses: 2, lastUsed: '2026-10-08T10:01:00.000Z' });

    writes.mockClear();
    await brain.recall('obsidian handles');
    await brain.recall('obsidian handles');
    expect(writes).toHaveBeenCalledTimes(1);
  });
});
