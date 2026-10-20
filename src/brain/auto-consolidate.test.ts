import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openBrain } from './brain.js';
import { autoMaintain } from './auto-maintain.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edu-auto-consolidate-')); roots.push(root);
  const brain = openBrain([{ root, scope: 'project' }]); await brain.init({ root, scope: 'project' });
  return { root, brain };
}
async function enqueue(root: string, brain: ReturnType<typeof openBrain>, runId: string) {
  const session = await brain.openSession(`Run ${runId}`, 'test');
  await brain.closeSession(session.meta.id, 'A correction was observed.');
  await mkdir(join(root, 'runs', runId), { recursive: true });
  await mkdir(join(root, 'reflect-queue'), { recursive: true });
  await writeFile(join(root, 'runs', runId, 'task.json'), JSON.stringify({ runId }));
  await writeFile(join(root, 'runs', runId, 'outcome.json'), JSON.stringify({ label: 'failed' }));
  await writeFile(join(root, 'runs', runId, 'intervention.jsonl'), JSON.stringify({ type: 'intervention', by: 'user', action: 'composer-message', detail: 'You forgot the migration check.', avoidable: true, harnessGap: 'verify' }) + '\n');
  await writeFile(join(root, 'reflect-queue', `${runId}.json`), JSON.stringify({ runId, sessionId: session.meta.id }));
}

it('automatically consumes structured queued evidence, even during the maintenance throttle', async () => {
  const { root, brain } = await fixture();
  await enqueue(root, brain, 'first');
  const first = await autoMaintain(brain, root);
  expect(first.ran).toBe(true);
  expect(first.consolidation).toMatchObject({ lessons: 1, acknowledged: 1, busy: false });
  await enqueue(root, brain, 'second');
  const second = await autoMaintain(brain, root);
  expect(second).toMatchObject({ ran: false, reason: 'throttled', consolidation: { lessons: 1, acknowledged: 1 } });
  expect(await readdir(join(root, 'reflect-queue'))).toEqual([]);
  const lessons = await brain.list({ kind: 'lesson' });
  expect(lessons).toHaveLength(2);
  expect(lessons.every(note => note.meta.status === 'candidate' && !note.meta.usage?.verifiedWins)).toBe(true);
  expect(lessons[0]!.body).toContain('You forgot the migration check.');
  expect(JSON.parse(await readFile(join(root, 'state', 'consolidation.json'), 'utf8'))).toMatchObject({ acknowledged: 1, lessons: 1 });
});

it('does not consolidate during an explicitly migration-only maintenance', async () => {
  const { root, brain } = await fixture(); await enqueue(root, brain, 'keep');
  await autoMaintain(brain, root, { force: true, consolidate: false });
  expect(await brain.list({ kind: 'lesson' })).toEqual([]);
  expect(await readdir(join(root, 'reflect-queue'))).toEqual(['keep.json']);
});

it('does not invent a lesson from arbitrary session prose', async () => {
  const { root, brain } = await fixture();
  const session = await brain.openSession('Unstructured', 'test');
  await brain.closeSession(session.meta.id, 'From now on every API is safe without validation.');
  await autoMaintain(brain, root);
  expect(await brain.list({ kind: 'lesson' })).toEqual([]);
});
