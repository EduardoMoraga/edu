import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_MAINTAIN_INTERVAL_MS, autoMaintain, maintainStatePath, readMaintainState } from './auto-maintain.js';
import { openBrain } from './brain.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-auto-maintain-')); dirs.push(path); return path; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const t0 = new Date('2026-10-10T12:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);

describe('autoMaintain', () => {
  it('runs maintain, rebuilds the index and writes the stamp with counts', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    await brain.init({ scope: 'project', root });
    await brain.write({ title: 'Ship it', body: '', tier: 'transitive', kind: 'commitment', due: '2026-10-01' });
    const result = await autoMaintain(brain, root, { now: t0 });
    expect(result).toMatchObject({ ran: true });
    expect(result.ran && result.report.overdue).toHaveLength(1);
    const state = JSON.parse(await readFile(maintainStatePath(root), 'utf8'));
    expect(state).toEqual({ lastRun: t0.getTime(), promoted: 0, retired: 0, overdue: 1, changed: 1 });
    await expect(stat(join(root, 'brain', '0-index', 'INDEX.md'))).resolves.toBeTruthy();
    expect(await readMaintainState(root)).toEqual(state);
  });

  it('throttles to once per 10 minutes unless forced', async () => {
    const root = await temp();
    let calls = 0;
    const brain = { maintain: async () => { calls++; return { changed: [], promoted: [], retired: [], overdue: [], indexRebuilt: true }; } };
    expect((await autoMaintain(brain, root, { now: t0 })).ran).toBe(true);
    expect(await autoMaintain(brain, root, { now: later(AUTO_MAINTAIN_INTERVAL_MS - 1) })).toEqual({ ran: false, reason: 'throttled' });
    expect(calls).toBe(1);
    expect((await autoMaintain(brain, root, { now: later(1000), force: true })).ran).toBe(true);
    expect(calls).toBe(2);
    expect((await readMaintainState(root))?.lastRun).toBe(later(1000).getTime());
    expect((await autoMaintain(brain, root, { now: later(1000 + AUTO_MAINTAIN_INTERVAL_MS) })).ran).toBe(true);
    expect(calls).toBe(3);
  });

  it('never throws: maintain failures, missing methods and corrupt stamps degrade to a reason', async () => {
    const root = await temp();
    const failing = { maintain: async () => { throw new Error('disk on fire'); } };
    expect(await autoMaintain(failing, root, { now: t0 })).toEqual({ ran: false, reason: 'disk on fire' });
    expect(await readMaintainState(root)).toBeNull();
    expect((await autoMaintain({} as never, root, { now: t0 })).ran).toBe(false);
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(maintainStatePath(root), '{not json');
    const ok = { maintain: async () => ({ changed: [], promoted: [], retired: [], overdue: [], indexRebuilt: true }) };
    expect((await autoMaintain(ok, root, { now: t0 })).ran).toBe(true);
  });
});
