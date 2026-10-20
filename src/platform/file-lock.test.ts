import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const lockModule = fileURLToPath(new URL('./file-lock.ts', import.meta.url));

/** Worker: increments a shared counter file inside the lock (read, pause, write) so any overlap loses updates. */
const worker = (lock: string, root: string, counter: string, rounds: number) => `
import { readFile, writeFile } from 'node:fs/promises';
import { withHostLock } from ${JSON.stringify(lock)};
for (let i = 0; i < ${rounds}; i++) {
  await withHostLock(${JSON.stringify(root)}, 'test', 'shared', async () => {
    const n = Number(await readFile(${JSON.stringify(counter)}, 'utf8'));
    await new Promise(r => setTimeout(r, 5));
    await writeFile(${JSON.stringify(counter)}, String(n + 1));
  }, 20000);
}
`;

describe('withHostLock across real processes', () => {
  it('serializes a read-modify-write critical section over 4 node processes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edu-lock-proc-'));
    try {
      const counter = join(dir, 'counter');
      await writeFile(counter, '0');
      const script = join(dir, 'worker.mts');
      await writeFile(script, worker(lockModule, join(dir, 'brain'), counter, 8));
      const children = Array.from({ length: 4 }, () => new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', script], { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', code => resolve(code ?? -1));
      }));
      expect(await Promise.all(children)).toEqual([0, 0, 0, 0]);
      expect(Number(await readFile(counter, 'utf8'))).toBe(32);
      expect(await readdir(join(dir, 'brain', 'state', 'locks'))).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
});
