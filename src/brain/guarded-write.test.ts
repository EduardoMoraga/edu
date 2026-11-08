import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteMeta } from '../core/contracts.js';
import { openBrain } from './brain.js';
import { parseMarkdown } from './frontmatter.js';
import { resetLedgerCache } from './ledger.js';
import { NoteConflictError, contentHash, resetNoteCache } from './store.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-guard-')); dirs.push(path); return path; }
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('provenance', () => {
  it('records host (default os.hostname()), agent and session on write and omits undefined fields', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const plain = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Plain', body: 'x' });
    expect(plain.meta.host).toBe(hostname());
    const disk = await readFile(plain.path, 'utf8');
    expect(disk).toContain(`host: ${hostname()}`);
    expect(disk).not.toMatch(/^(agent|session):/m);
    const by = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'By agent', body: 'x', by: { host: 'laptop', agent: 'codex', session: 'S-1' } });
    expect(parseMarkdown<NoteMeta>(await readFile(by.path, 'utf8')).meta).toMatchObject({ host: 'laptop', agent: 'codex', session: 'S-1', source: 'user' });
  });

  it('replaces provenance on update only when the caller says who is writing; patches cannot forge it', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: 'Cache helps', body: 'x', by: { agent: 'claude-code', session: 'S-1' } });
    expect((await brain.update(note.meta.id, { tags: ['perf'] })).meta).toMatchObject({ agent: 'claude-code', session: 'S-1' });
    const edited = await brain.update(note.meta.id, {}, 'y', { by: { host: 'cloud-box', agent: 'pi' } });
    expect(edited.meta).toMatchObject({ host: 'cloud-box', agent: 'pi' });
    expect(edited.meta.session).toBeUndefined();
    await expect(brain.update(note.meta.id, { agent: 'forged' } as Partial<NoteMeta>)).rejects.toThrow("'agent'");
  });

  it('records the session that closes a session note', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const session = await brain.openSession('Pairing', 'claude', { agent: 'claude-code', session: 'abc' });
    expect(session.meta).toMatchObject({ agent: 'claude-code', session: 'abc' });
    expect((await brain.closeSession(session.meta.id, 'done', { by: { agent: 'claude-code', session: 'abc' } })).meta.status).toBe('closed');
  });
});

describe('content hash and guarded writes', () => {
  it('is stable across recall, exposure and feedback and changes with content', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Hash me', body: 'stable content' });
    const hash = await brain.hashOf(note.meta.id);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(contentHash(note)).toBe(hash);
    await brain.recall('stable content');
    await brain.feedback(note.meta.id, true);
    expect(await brain.hashOf(note.meta.id)).toBe(hash);
    await brain.update(note.meta.id, {}, 'changed content');
    expect(await brain.hashOf(note.meta.id)).not.toBe(hash);
    expect(await brain.hashOf('L-missing')).toBeUndefined();
  });

  it('does not depend on key order', () => {
    const meta = { id: 'L-a', tier: 'transitive', title: 'a', tags: [], links: [], created: 'c' } as NoteMeta;
    const reordered = { created: 'c', links: [], tags: [], title: 'a', tier: 'transitive', id: 'L-a', updated: 'later' } as NoteMeta;
    expect(contentHash({ meta, body: 'b\r\n' })).toBe(contentHash({ meta: reordered, body: 'b' }));
  });

  it('applies an update whose expectedHash matches and rejects a stale one with NoteConflictError', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: 'Guarded', body: 'v1' });
    const h1 = (await brain.hashOf(note.meta.id))!;
    await brain.update(note.meta.id, {}, 'v2', { expectedHash: h1 });
    const error = await brain.update(note.meta.id, {}, 'v3', { expectedHash: h1 }).catch(caught => caught);
    expect(error).toBeInstanceOf(NoteConflictError);
    expect(error).toMatchObject({ code: 'note-conflict', id: note.meta.id, expectedHash: h1, currentHash: await brain.hashOf(note.meta.id) });
    expect((await brain.read(note.meta.id))?.body).toBe('v2');
  });

  it('lets exactly one of two concurrent writers with the same expectedHash win', async () => {
    const root = await temp();
    const a = openBrain([{ scope: 'project', root }]), b = openBrain([{ scope: 'project', root }]);
    const note = await a.write({ tier: 'transitive', kind: 'hypothesis', title: 'Race', body: 'base' });
    const hash = (await a.hashOf(note.meta.id))!;
    const results = await Promise.allSettled([
      a.update(note.meta.id, {}, 'from a', { expectedHash: hash }),
      b.update(note.meta.id, {}, 'from b', { expectedHash: hash }),
      a.update(note.meta.id, {}, 'from a2', { expectedHash: hash }),
    ]);
    const won = results.filter(result => result.status === 'fulfilled');
    const lost = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost.every(result => result.reason instanceof NoteConflictError)).toBe(true);
    expect((await a.read(note.meta.id))?.body).toBe((won[0] as PromiseFulfilledResult<{ body: string }>).value.body);
  });
});
