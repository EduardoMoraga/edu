import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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
  return withDirLock(join(root, 'state', 'locks'), 'brain-usage.lock', body);
}

/** Directory of the append lock of a brain folder's `0-index/log.md` (machine-local, never published). */
export function logLockDir(brainDir: string): string {
  return join(brainDir, '.edu-local', 'locks', 'log.lock');
}

/**
 * Exclusion for writes to a brain folder's append-only `0-index/log.md`: log writers and `edu sync` (which rewrites
 * the log while resolving a merge) take it. Keyed on the physical folder, so every spelling of the brain (a link,
 * a junction) contends on the same lock. Innermost: nothing else is acquired while it is held.
 */
export async function withLogLock<T>(brainDir: string, body: () => Promise<T>): Promise<T> {
  const dir = logLockDir(brainDir);
  return withDirLock(dirname(dir), basename(dir), body);
}

async function withDirLock<T>(locks: string, name: string, body: () => Promise<T>): Promise<T> {
  const dir = join(locks, name);
  await mkdir(locks, { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    let acquired = false;
    let contention: unknown;
    try { await mkdir(dir); acquired = true; }
    catch (error) {
      contention = error;
      // Windows can report EPERM while the previous owner's directory is delete-pending.
      // Retry within the same deadline; a permission error is never evidence of a stale owner.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && !transientDirectoryError(error)) throw error;
    }
    if (acquired) {
      try { await writeFile(join(dir, 'owner'), String(process.pid)); }
      catch (error) { await removeOwnedLock(dir); throw error; }
      break;
    }
    if ((contention as NodeJS.ErrnoException)?.code === 'EEXIST' && await stale(dir)) {
      const claimed = `${dir}.stale-${process.pid}-${Date.now()}`;
      try { await rename(dir, claimed); await rm(claimed, { recursive: true, force: true }); } catch { /* another contender won */ }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for the brain ${name === 'brain-usage.lock' ? 'usage' : 'log'} lock`);
    await pause(10);
  }
  try { return await body(); }
  finally { await removeOwnedLock(dir); }
}

function transientDirectoryError(error: unknown): boolean {
  return ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '');
}

/** Retry only cleanup of a directory this invocation acquired, never replay the body. */
async function removeOwnedLock(dir: string): Promise<void> {
  const deadline = Date.now() + 1000;
  for (;;) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (error) {
      if (!transientDirectoryError(error) || Date.now() >= deadline) throw error;
      await pause(10);
    }
  }
}

async function stale(dir: string): Promise<boolean> {
  try {
    if (Date.now() - (await stat(dir)).mtimeMs < STALE_MS) return false;
    const pid = Number((await readFile(join(dir, 'owner'), 'utf8').catch(() => '')).trim());
    return !(Number.isInteger(pid) && pid > 0 && alive(pid));
  } catch { return false; }
}
