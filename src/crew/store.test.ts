import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCrewStore } from './store.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('crew store', () => {
  it('persists jobs atomically and appends events as JSONL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-store-'));
    roots.push(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'Build it', mode: 'headless', cwd: root, autonomy: 'ask' });
    await store.update(job.id, { status: 'running', pid: 123 });
    await store.appendEvent(job.id, { type: 'agent.text', agentId: job.id, text: 'working', at: new Date().toISOString() });
    expect((await store.get(job.id))?.pid).toBe(123);
    expect((await store.list()).map(item => item.id)).toContain(job.id);
    expect(await readFile(join(root, 'crew', `${job.id}.jsonl`), 'utf8')).toContain('"working"');
  });
});
