import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicFs } from '../brain/store.js';
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
    expect(await readFile(join(root, 'crew', `${job.id}.jsonl`), 'utf8')).toContain('crew output artifact');
  });

  it('retries a job update while Windows holds the job file open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-store-'));
    roots.push(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'Build it', mode: 'headless', cwd: root, autonomy: 'ask' });
    const realRename = atomicFs.rename;
    vi.spyOn(atomicFs, 'sleep').mockResolvedValue(undefined);
    const rename = vi.spyOn(atomicFs, 'rename')
      .mockRejectedValueOnce(Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }))
      .mockImplementation(realRename);
    try {
      await store.update(job.id, { status: 'awaiting-approval' });
      expect(rename).toHaveBeenCalledTimes(2);
      expect((await store.get(job.id))?.status).toBe('awaiting-approval');
    } finally { vi.restoreAllMocks(); }
  });

  it('stores a bounded safe preview and retrieves the full sanitized result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-store-')); roots.push(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'Build it', mode: 'headless', cwd: root, autonomy: 'ask' });
    const raw = `api_key=supersecretvalue ${'x'.repeat(3000)}`;
    const updated = await store.update(job.id, { status: 'done', summary: raw });
    expect(updated.summary.length).toBeLessThan(1400);
    expect(updated.summary).toContain('truncated');
    expect(updated.summary).not.toContain('supersecretvalue');
    const page = await store.artifact(job.id, 'summary', 0, 4096);
    expect(page.text).toContain('x'.repeat(3000));
    expect(page.text).not.toContain('supersecretvalue');
    await store.appendEvent(job.id, { type: 'agent.text', agentId: job.id, text: raw, at: new Date().toISOString() });
    await store.appendEvent(job.id, { type: 'agent.end', agentId: job.id, ok: true, summary: 'done', at: new Date().toISOString() });
    expect((await store.events(job.id))[0]).toMatchObject({ type: 'agent.text' });
    expect(JSON.stringify(await store.events(job.id))).not.toContain('supersecretvalue');
    expect((await store.artifact(job.id, 'output', 0, 4096)).text).toContain('x'.repeat(3000));
  });

  it('fails the job without raw metadata when artifact persistence fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-store-')); roots.push(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'Build it', mode: 'headless', cwd: root, autonomy: 'ask' });
    await rm(join(root, 'crew', 'artifacts'), { recursive: true, force: true });
    await writeFile(join(root, 'crew', 'artifacts'), 'blocks directory creation');
    const failed = await store.update(job.id, { status: 'done', summary: 'password=supersecretvalue' });
    expect(failed.status).toBe('failed');
    expect(failed.endedAt).toBeTruthy();
    expect(failed.summary).toContain('artifact persistence failed');
    expect(await readFile(join(root, 'crew', `${job.id}.json`), 'utf8')).not.toContain('supersecretvalue');
  });

  it('redacts secrets split across text deltas and nested event fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-store-')); roots.push(root);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'Use db_password=hidden123', mode: 'headless', cwd: root, autonomy: 'ask' });
    expect(job.task).not.toContain('hidden123');
    await store.appendEvent(job.id, { type: 'agent.text', agentId: job.id, text: 'password=', at: new Date().toISOString() });
    await store.appendEvent(job.id, { type: 'agent.text', agentId: job.id, text: 'splitsecret\n', at: new Date().toISOString() });
    await store.appendEvent(job.id, { type: 'tool.result', agentId: job.id, callId: 'c', ok: true, output: { nested: { db_password: 'nestedsecret' } }, at: new Date().toISOString() } as unknown as import('../core/contracts.js').EduEvent);
    await store.update(job.id, { status: 'done', summary: 'done' });
    const output = (await store.artifact(job.id, 'output')).text;
    expect(output).not.toContain('splitsecret');
    expect(output).toContain('[REDACTED]');
    const events = await readFile(join(root, 'crew', `${job.id}.jsonl`), 'utf8');
    expect(events).not.toContain('splitsecret');
    expect(events).not.toContain('nestedsecret');
  });
});

describe('crew job id prefixes', () => {
  it('resolves a unique prefix and rejects an ambiguous one', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const store = createCrewStore(await mkdtemp(join(tmpdir(), 'edu-crew-prefix-')));
    const job = await store.create({ cli: 'codex', task: 't', mode: 'headless', cwd: '/', autonomy: 'readonly' });
    expect((await store.get(job.id.slice(0, 8)))?.id).toBe(job.id);
    expect(await store.get('ffffffff')).toBeUndefined();
  });
});
