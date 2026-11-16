import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installLockPath, withInstallLock } from './install-lock.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function home(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'edu-lock-')); dirs.push(dir); return dir; }
const gone = (path: string) => access(path).then(() => false, () => true);

describe('withInstallLock', () => {
  it('serializes concurrent installs on the same HOME and releases the lock', async () => {
    const h = await home();
    const order: string[] = [];
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const running = new Promise<void>(done => { started = done; });
    const first = withInstallLock(h, async () => { order.push('first:start'); started(); await gate; order.push('first:end'); });
    await running;
    // The second install finds the lock held; its first wait lets the first install finish.
    const second = withInstallLock(h, async () => { order.push('second'); }, { sleep: async () => { release(); await new Promise(done => setImmediate(done)); } });
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(await gone(installLockPath(h))).toBe(true);
  });

  it('lets nested calls in the same flow reuse the held lock', async () => {
    const h = await home();
    await expect(withInstallLock(h, () => withInstallLock(h, async () => 'inner', { waitMs: 0 }))).resolves.toBe('inner');
  });

  it('fails clearly while a live process holds the lock', async () => {
    const h = await home();
    await mkdir(installLockPath(h));
    await writeFile(join(installLockPath(h), 'owner'), `${process.pid} ${hostname()}\n`);
    await expect(withInstallLock(h, async () => 'ran', { waitMs: 0 })).rejects.toThrow(/Another Edu install.*\.edu-install\.lock/);
  });

  it('reclaims a lock whose owner process has exited', async () => {
    const h = await home();
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    await mkdir(installLockPath(h));
    await writeFile(join(installLockPath(h), 'owner'), `${dead} ${hostname()}\n`);
    await expect(withInstallLock(h, async () => 'ran', { waitMs: 0 })).resolves.toBe('ran');
    expect(await gone(installLockPath(h))).toBe(true);
  });
});
