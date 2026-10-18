import { mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BrainLocation } from '../core/contracts.js';
import { brainPath } from './location.js';

export const lockFs = {
  mkdir, open, realpath, unlink,
  sleep: (ms: number) => new Promise<void>(done => setTimeout(done, ms)),
};
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const BACKOFF_MS = [10, 20, 40, 80, 160, 320, 400, 400, 400];
export class BrainLockUnavailableError extends Error {}

async function release(path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await lockFs.unlink(path); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      const delay = BACKOFF_MS[attempt];
      if (!TRANSIENT.has(code ?? '') || delay === undefined) {
        // The mutation may already be durable. Do not replace its result/error with cleanup failure.
        console.warn(`Edu: cannot release brain lock ${path} (${code ?? 'UNKNOWN'}). Verify its owner before manual recovery.`);
        return;
      }
      await lockFs.sleep(delay);
    }
  }
}

/**
 * Cross-process exclusion. Never steal a lock on a timer: a slow/live writer must not lose
 * ownership. A crashed writer leaves a fail-closed lock; the error identifies the file for
 * manual recovery after verifying that the owning process has exited.
 */
export async function withFileLock<T>(path: string, action: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let handle: FileHandle;
  try {
    await lockFs.mkdir(dirname(path), { recursive: true });
    for (let attempt = 0; ; attempt++) {
      try { handle = await lockFs.open(path, 'wx'); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && !TRANSIENT.has(code ?? '')) throw error;
        if (Date.now() >= deadline) throw new BrainLockUnavailableError(`Timed out acquiring brain lock ${path}. Remove it only after verifying its owner has exited.`, { cause: error });
        await lockFs.sleep(Math.min(code === 'EEXIST' ? 20 : (BACKOFF_MS[attempt] ?? 400), Math.max(0, deadline - Date.now())));
      }
    }
  } catch (error) {
    if (error instanceof BrainLockUnavailableError) throw error;
    throw new BrainLockUnavailableError(`Cannot acquire brain lock ${path}.`, { cause: error });
  }
  try {
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, created: new Date().toISOString() }), 'utf8'); }
    catch (error) { throw new BrainLockUnavailableError(`Cannot initialize brain lock ${path}.`, { cause: error }); }
    return await action();
  } finally {
    try { await handle.close(); }
    catch { console.warn(`Edu: cannot close brain lock ${path}.`); }
    await release(path);
  }
}

/** Resolve aliases and acquire every overlay in a stable order, preventing lock-order deadlocks. */
export async function withBrainLocks<T>(locations: BrainLocation[], action: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const paths: string[] = [];
  try {
    for (const location of locations) {
      const path = brainPath(location);
      await lockFs.mkdir(path, { recursive: true });
      paths.push(await lockFs.realpath(path));
    }
  } catch (error) {
    throw new BrainLockUnavailableError('Cannot resolve brain lock locations.', { cause: error });
  }
  const unique = [...new Set(paths.map(path => process.platform === 'win32' ? path.toLowerCase() : path))].sort();
  const acquire = (index: number): Promise<T> => index === unique.length ? action() : withFileLock(join(unique[index]!, '.edu-write.lock'), () => acquire(index + 1), timeoutMs);
  return acquire(0);
}
