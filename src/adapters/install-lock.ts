/**
 * One Edu install, setup or uninstall at a time per HOME: they all edit the same host configs, the shared
 * target registry and the manifests. The lock is a directory next to ~/.edu (never inside it, so an
 * uninstall can still remove an empty ~/.edu). `mkdir` is atomic on every platform. Nested calls in the
 * same async flow (setup → install) reuse the held lock; a lock whose owner process is gone is reclaimed.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { withFsRetry } from '../platform/fs-retry.js';

export const INSTALL_LOCK_WAIT_MS = 120_000;
/** A lock directory with no owner file yet (its creator is between mkdir and write) is only stale after this. */
const OWNERLESS_STALE_MS = 10_000;
const held = new AsyncLocalStorage<ReadonlySet<string>>();

export function installLockPath(home: string): string { return join(resolve(home), '.edu-install.lock'); }

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

async function stale(path: string): Promise<boolean> {
  try {
    const owner = await readFile(join(path, 'owner'), 'utf8').catch(() => undefined);
    if (owner === undefined) return Date.now() - (await stat(path)).mtimeMs > OWNERLESS_STALE_MS;
    const [pid, host] = owner.trim().split(/\s+/, 2);
    // Another machine's lock (a shared network HOME) is never judged by a local process table.
    if (host && host !== hostname()) return false;
    return !(Number.isInteger(Number(pid)) && Number(pid) > 0 && alive(Number(pid)));
  } catch { return false; }
}

export async function withInstallLock<T>(home: string, body: () => Promise<T>, options: { waitMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const path = installLockPath(home);
  const store = held.getStore();
  if (store?.has(path)) return body();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(done => setTimeout(done, ms)));
  const deadline = Date.now() + (options.waitMs ?? INSTALL_LOCK_WAIT_MS);
  for (;;) {
    try { await mkdir(path); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (await stale(path)) {
      // Claim by rename so two contenders cannot both delete a lock a third one just re-created.
      const claimed = `${path}.stale-${process.pid}-${Date.now()}`;
      try { await rename(path, claimed); await rm(claimed, { recursive: true, force: true }); } catch { /* Someone else won. */ }
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Another Edu install, setup or uninstall is running (lock ${path}). Wait for it to finish; if none is running, delete that folder and try again.`);
    }
    await sleep(50);
  }
  try {
    await writeFile(join(path, 'owner'), `${process.pid} ${hostname()}\n`);
    return await held.run(new Set([...(store ?? []), path]), body);
  } finally {
    await withFsRetry(() => rm(path, { recursive: true, force: true }));
  }
}
