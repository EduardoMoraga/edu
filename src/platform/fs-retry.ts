/**
 * Windows reports a file another process holds open (an editor, an antivirus scanner, a search indexer,
 * a host CLI reading its own config) with EBUSY, EPERM or EACCES. The installer's writes, renames and
 * removals retry with backoff, as brain/store.ts does for its atomic rename, instead of failing half-way.
 * On macOS and Linux EPERM and EACCES are real permission errors, so only EBUSY is retried there.
 */
import { readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';

/** Backoff between attempts, ~1.8 s in total (graceful-fs style, the same as brain/store.ts). */
export const FS_RETRY_BACKOFF_MS = [10, 20, 40, 80, 160, 320, 400, 400, 400];

/** Process-wide defaults; tests replace `platform` and `sleep` to exercise the Windows branch without waiting. */
export const fsRetryDefaults: { platform: NodeJS.Platform; sleep: (ms: number) => Promise<void> } = {
  platform: process.platform,
  sleep: (ms: number) => new Promise<void>(done => setTimeout(done, ms)),
};

export function isTransientLock(error: unknown, platform: NodeJS.Platform = fsRetryDefaults.platform): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EBUSY' || (platform === 'win32' && (code === 'EPERM' || code === 'EACCES'));
}

export interface FsRetryOptions { platform?: NodeJS.Platform; sleep?: (ms: number) => Promise<void>; backoff?: readonly number[] }

/** Runs `op`, retrying while the target is held open by another process; any other error throws at once. */
export async function withFsRetry<T>(op: () => Promise<T>, options: FsRetryOptions = {}): Promise<T> {
  const platform = options.platform ?? fsRetryDefaults.platform;
  const sleep = options.sleep ?? fsRetryDefaults.sleep;
  const backoff = options.backoff ?? FS_RETRY_BACKOFF_MS;
  for (let attempt = 0; ; attempt++) {
    try { return await op(); }
    catch (error) {
      const delay = backoff[attempt];
      if (delay === undefined || !isTransientLock(error, platform)) throw error;
      await sleep(delay);
    }
  }
}

/** The file operations the installer uses, each retried while Windows holds the target open. */
export const retryFs = {
  readFile: (path: string) => withFsRetry(() => readFile(path)),
  writeFile: (path: string, content: Buffer | string) => withFsRetry(() => writeFile(path, content)),
  rename: (from: string, to: string) => withFsRetry(() => rename(from, to)),
  unlink: (path: string) => withFsRetry(() => unlink(path)),
  rmdir: (path: string) => withFsRetry(() => rmdir(path)),
};
