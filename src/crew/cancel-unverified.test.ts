import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { describeProcess } from '../platform/process-tree.js';
import { createCrew } from './index.js';
import { createCrewStore } from './store.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('cancels without signalling when ps cannot verify the worker, and says how to stop it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edu-crew-unverified-')); roots.push(root);
  await openBrain([{ scope: 'project', root }]).init({ scope: 'project', root });
  const store = createCrewStore(root);
  const job = await store.create({ cli: 'codex', task: 'Unverifiable', mode: 'headless', cwd: root, autonomy: 'ask' });
  await store.update(job.id, { status: 'running', pid: 818 });
  const signals: string[] = [];
  const crew = createCrew({
    brainRoot: root, store, sleep: async () => undefined, isAlive: () => true,
    describeProcess: pid => describeProcess(pid, { platform: 'darwin', alive: () => true, run: async () => { throw Object.assign(new Error('Command failed'), { code: 1 }); } }),
    stopProcess: async (pid, signal) => { signals.push(`${pid}:${signal}`); },
  });
  const cancelled = await crew.cancel(job.id);
  expect(signals).toEqual([]);
  expect(cancelled).toMatchObject({ status: 'cancelled', summary: 'Cancelled on request.' });
  expect(cancelled.note).not.toContain('no longer this job\'s worker');
  expect(cancelled.note).toMatch(/could not be verified .*\(ps exited with code 1\).*may still be running.*kill -TERM -- -818$/);
});
