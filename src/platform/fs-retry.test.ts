import { describe, expect, it } from 'vitest';
import { FS_RETRY_BACKOFF_MS, isTransientLock, withFsRetry } from './fs-retry.js';

const locked = (code: string) => Object.assign(new Error(`${code}: resource busy or locked`), { code });

function flaky(failures: string[]) {
  let calls = 0;
  return { op: async () => { const code = failures[calls++]; if (code) throw locked(code); return calls; }, calls: () => calls };
}

describe('withFsRetry', () => {
  it('retries a file Windows holds open, with backoff and no real waiting', async () => {
    const waits: number[] = [];
    const { op, calls } = flaky(['EBUSY', 'EPERM', 'EACCES']);
    await expect(withFsRetry(op, { platform: 'win32', sleep: async ms => { waits.push(ms); } })).resolves.toBe(4);
    expect(calls()).toBe(4);
    expect(waits).toEqual(FS_RETRY_BACKOFF_MS.slice(0, 3));
  });

  it('gives up with the last error once the backoff is exhausted', async () => {
    const { op, calls } = flaky(Array.from({ length: 20 }, () => 'EBUSY'));
    await expect(withFsRetry(op, { platform: 'win32', sleep: async () => {} })).rejects.toMatchObject({ code: 'EBUSY' });
    expect(calls()).toBe(FS_RETRY_BACKOFF_MS.length + 1);
  });

  it('treats EPERM and EACCES as real permission errors outside Windows', async () => {
    const { op, calls } = flaky(['EPERM']);
    await expect(withFsRetry(op, { platform: 'linux', sleep: async () => {} })).rejects.toMatchObject({ code: 'EPERM' });
    expect(calls()).toBe(1);
    expect(isTransientLock(locked('EBUSY'), 'darwin')).toBe(true);
    expect(isTransientLock(locked('EACCES'), 'darwin')).toBe(false);
    expect(isTransientLock(locked('ENOENT'), 'win32')).toBe(false);
  });
});
