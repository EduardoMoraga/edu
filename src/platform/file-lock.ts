import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30_000;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/**
 * Cross-process exclusion per host id: `mkdir` is atomic. The directory is named by a digest, so host ids
 * and sources never reach the file system. A lock is stale only when it is old AND its owner process is gone;
 * a live owner is never evicted, so after LOCK_WAIT_MS the caller fails (the hook reports it and the host goes on).
 */
export async function withHostLock<T>(root: string, source: string, key: string, body: () => Promise<T>, waitMs = LOCK_WAIT_MS): Promise<T> {
  const dir = join(root, 'state', 'locks', `${createHash('sha256').update(`${source}\0${key}`).digest('hex').slice(0, 32)}.lock`);
  await mkdir(join(root, 'state', 'locks'), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await mkdir(dir);
      await writeFile(join(dir, 'owner'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (await staleLock(dir)) {
      // Claim by rename so two contenders cannot both remove a lock that a third just re-created.
      const claimed = `${dir}.stale-${process.pid}-${Date.now()}`;
      try { await rename(dir, claimed); await rm(claimed, { recursive: true, force: true }); } catch { /* someone else won */ }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for the ${source} session lock`);
    await pause(25);
  }
  try {
    return await body();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function staleLock(dir: string): Promise<boolean> {
  try {
    const age = Date.now() - (await stat(dir)).mtimeMs;
    if (age < LOCK_STALE_MS) return false;
    const pid = Number((await readFile(join(dir, 'owner'), 'utf8').catch(() => '')).trim());
    return !(Number.isInteger(pid) && pid > 0 && alive(pid));
  } catch {
    return false; // vanished or unreadable: retry mkdir / keep waiting, never delete blindly
  }
}
