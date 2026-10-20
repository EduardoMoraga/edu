import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WAIT_MS = 15_000;
const STALE_MS = 30_000;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };

/**
 * Exclusion for read-modify-write of note usage (feedback, exposure, lifecycle writes) across processes and
 * brain instances sharing one `.edu` root. `mkdir` is atomic; a lock is stale only when old AND its owner is gone.
 * Deliberately independent of the CLI/session locks.
 */
export async function withUsageLock<T>(root: string, body: () => Promise<T>): Promise<T> {
  const locks = join(root, 'state', 'locks');
  const dir = join(locks, 'brain-usage.lock');
  await mkdir(locks, { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try { await mkdir(dir); await writeFile(join(dir, 'owner'), String(process.pid)); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (await stale(dir)) {
      const claimed = `${dir}.stale-${process.pid}-${Date.now()}`;
      try { await rename(dir, claimed); await rm(claimed, { recursive: true, force: true }); } catch { /* another contender won */ }
      continue;
    }
    if (Date.now() > deadline) throw new Error('timed out waiting for the brain usage lock');
    await pause(10);
  }
  try { return await body(); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

async function stale(dir: string): Promise<boolean> {
  try {
    if (Date.now() - (await stat(dir)).mtimeMs < STALE_MS) return false;
    const pid = Number((await readFile(join(dir, 'owner'), 'utf8').catch(() => '')).trim());
    return !(Number.isInteger(pid) && pid > 0 && alive(pid));
  } catch { return false; }
}
