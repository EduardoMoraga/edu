import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withUsageLock } from './note-lock.js';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), rm: vi.fn(actual.rm), writeFile: vi.fn(actual.writeFile) };
});
const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const roots: string[] = [];
const ioError = (code: string) => Object.assign(new Error(code), { code });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-usage-windows-'));
  roots.push(root);
  return { root, lock: join(root, 'state', 'locks', 'brain-usage.lock') };
}
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(mkdir).mockImplementation(native.mkdir);
  vi.mocked(rm).mockImplementation(native.rm);
  vi.mocked(writeFile).mockImplementation(native.writeFile);
  for (const root of roots.splice(0)) await native.rm(root, { recursive: true, force: true });
});

describe('brain usage lock Windows contention', () => {
  it('retries delete-pending EPERM without interpreting it as a stale owner', async () => {
    const { root, lock } = await fixture();
    let failures = 2;
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (path === lock && failures-- > 0) throw ioError('EPERM');
      return native.mkdir(path, options as never);
    });
    const body = vi.fn(async () => 'saved');
    expect(await withUsageLock(root, body)).toBe('saved');
    expect(body).toHaveBeenCalledTimes(1);
    expect(failures).toBe(-1);
  });

  it('retries owned directory cleanup without replaying a successful body', async () => {
    const { root, lock } = await fixture();
    let failures = 2;
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (path === lock && failures-- > 0) throw ioError('ENOTEMPTY');
      return native.rm(path, options);
    });
    const body = vi.fn(async () => 7);
    expect(await withUsageLock(root, body)).toBe(7);
    expect(body).toHaveBeenCalledTimes(1);
    await expect(native.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans up an acquired directory when its owner record cannot be written', async () => {
    const { root, lock } = await fixture();
    vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
      if (path === join(lock, 'owner')) throw ioError('EIO');
      return native.writeFile(path, data, options);
    });
    const body = vi.fn(async () => undefined);
    await expect(withUsageLock(root, body)).rejects.toMatchObject({ code: 'EIO' });
    expect(body).not.toHaveBeenCalled();
    await expect(native.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bounds persistent EPERM contention without running the body or stealing a lock', async () => {
    const { root, lock } = await fixture();
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (path === lock) throw ioError('EPERM');
      return native.mkdir(path, options as never);
    });
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(20_000);
    const body = vi.fn(async () => undefined);
    await expect(withUsageLock(root, body)).rejects.toThrow('timed out waiting');
    expect(body).not.toHaveBeenCalled();
    await expect(native.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not swallow unrelated acquisition errors', async () => {
    const { root, lock } = await fixture();
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (path === lock) throw ioError('EROFS');
      return native.mkdir(path, options as never);
    });
    const body = vi.fn(async () => undefined);
    await expect(withUsageLock(root, body)).rejects.toMatchObject({ code: 'EROFS' });
    expect(body).not.toHaveBeenCalled();
  });
});
