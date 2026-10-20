import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain, type Brain } from '../brain/index.js';
import { createEduMcpServer } from './server.js';
import { closeWithLessons } from './session-learning.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'edu-session-learning-'));
  roots.push(root);
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  await brain.init(location);
  const server = createEduMcpServer({ locations: [location] });
  const client = new Client({ name: 'edu-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: res.isError === true, text: (res.content as { text: string }[])[0]!.text };
  };
  return { root, location, brain, call, close: async () => { await client.close(); await server.close(); } };
}
const lessonsOf = (brain: Brain) => brain.list({ kind: 'lesson' });
const three = (evidence: string) => [
  { title: 'Run the focused test before the suite', body: 'The focused run found the failure in seconds.', evidence: [evidence] },
  { title: 'Check the lock directory after a crash', body: 'A stale lock directory blocked the next hook run.' },
  { title: 'Pin the fixture clock', body: 'Unpinned dates made the snapshot flaky.' },
];

describe('edu_session_close lessons', () => {
  it('keeps same-titled lessons of different sessions and notes with the same title; a retry never duplicates', async () => {
    const t = await setup();
    try {
      const taken = await t.brain.write({ tier: 'transitive', kind: 'lesson', title: 'Pin the clock', body: 'mine' });
      const first = await t.brain.openSession('One', 'pi');
      const second = await t.brain.openSession('Two', 'pi');
      const closeWith = (id: string, body: string, extra: object[] = []) => t.call('edu_session_close', { id, summary: 'Done.', lessons: [{ title: 'Pin the clock', body }, ...extra] });
      expect((await closeWith(first.meta.id, 'first body')).isError).toBe(false);
      expect((await closeWith(second.meta.id, 'second body', [{ title: 'Pin the clock', body: 'another body, same session' }])).isError).toBe(false);
      const bodies = (await lessonsOf(t.brain)).map(n => n.body.split('\n')[0]).sort();
      expect(bodies).toEqual(['another body, same session', 'first body', 'mine', 'second body']);
      expect((await t.brain.read(taken.meta.id))?.body.trim()).toBe('mine');
      const retry = await closeWith(second.meta.id, 'second body', [{ title: 'Pin the clock', body: 'another body, same session' }]);
      expect(retry.isError).toBe(false);
      expect(await lessonsOf(t.brain)).toHaveLength(4);
      expect(new Set((await lessonsOf(t.brain)).map(n => n.meta.id)).size).toBe(4);
    } finally { await t.close(); }
  });

  it('reports a corrupt journal explicitly and does not rewrite a finished one on retry', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      const args = { id: session.meta.id, summary: 'Done.', lessons: [{ title: 'L1', body: 'x' }] };
      await t.call('edu_session_close', args);
      const dir = join(t.root, 'state', 'session-learning');
      const [file] = await readdir(dir);
      const path = join(dir, file!);
      const stamp = (await stat(path)).mtimeMs;
      await new Promise(resolve => setTimeout(resolve, 20));
      expect((await t.call('edu_session_close', args)).isError).toBe(false);
      expect((await stat(path)).mtimeMs).toBe(stamp);
      await writeFile(path, '{not json');
      const broken = await t.call('edu_session_close', args);
      expect(broken.isError).toBe(true);
      expect(broken.text).toContain('corrupt');
      expect(await readFile(path, 'utf8')).toBe('{not json');
      expect(await lessonsOf(t.brain)).toHaveLength(1);
    } finally { await t.close(); }
  });

  it('a note that merely carries the computed tag does not stand in for the lesson', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      const lesson = { title: 'Intended observation', body: 'Expected body' };
      const tag = `session-lesson:${createHash('sha256').update(JSON.stringify([session.meta.id, lesson])).digest('hex').slice(0, 16)}`;
      expect((await t.call('edu_remember', { tier: 'transitive', kind: 'lesson', title: 'Unrelated', body: 'Unrelated body', tags: [tag] })).isError).toBe(false);
      const closed = await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.', lessons: [lesson] });
      expect(closed.isError).toBe(false);
      const notes = await lessonsOf(t.brain);
      expect(notes.map(n => n.body.split('\n')[0]).sort()).toEqual(['Expected body', 'Unrelated body']);
      expect(notes.find(n => n.meta.title === 'Intended observation')?.meta.origin).toBe(`session:${session.meta.id}`);
      // A spoof that also squats the same title gets the full-hash suffix, and the spoof is left alone.
      const second = await t.brain.openSession('Two', 'pi');
      const squatted = { title: 'Squatted title', body: 'Expected body' };
      const tag2 = `session-lesson:${createHash('sha256').update(JSON.stringify([second.meta.id, squatted])).digest('hex').slice(0, 16)}`;
      expect((await t.call('edu_remember', { tier: 'transitive', kind: 'lesson', title: 'Squatted title', body: 'squatter', tags: [tag2] })).isError).toBe(false);
      expect((await t.call('edu_session_close', { id: second.meta.id, summary: 'Done.', lessons: [squatted] })).isError).toBe(false);
      const all = await lessonsOf(t.brain);
      expect(all.find(n => n.meta.title === 'Squatted title')?.body.trim()).toBe('squatter');
      expect(all.find(n => n.meta.title === `Squatted title · ${tag2.slice(-16)}`)?.body.startsWith('Expected body')).toBe(true);
      expect((await t.call('edu_session_close', { id: second.meta.id, summary: 'Done.', lessons: [squatted] })).isError).toBe(false);
      expect(await lessonsOf(t.brain)).toHaveLength(4);
    } finally { await t.close(); }
  });

  it('recognizes a record written by the earlier 6-hex build, but not an arbitrary suffix', async () => {
    const t = await setup();
    try {
      await t.brain.write({ tier: 'transitive', kind: 'lesson', title: 'Shared title', body: 'occupant' });
      const session = await t.brain.openSession('Work', 'pi');
      const lesson = { title: 'Shared title', body: 'Observed body' };
      const tag = `session-lesson:${createHash('sha256').update(JSON.stringify([session.meta.id, lesson])).digest('hex').slice(0, 16)}`;
      const record = (title: string) => t.brain.write({
        tier: 'transitive', kind: 'lesson', title, band: 'inferred', source: 'mcp', tags: ['session-lesson', tag], links: [session.meta.id],
        body: `${lesson.body}\n\nNoted by the host model when closing session [[${session.meta.id}]]; not verified.`, provenance: { origin: `session:${session.meta.id}` },
      });
      const old = await record(`Shared title · ${tag.slice(-6)}`);
      await t.brain.closeSession(session.meta.id, 'Done.');
      const dir = join(t.root, 'state', 'session-learning');
      await mkdir(dir, { recursive: true });
      const hash = createHash('sha256').update(JSON.stringify({ session: session.meta.id, summary: 'Done.', lessons: [lesson] })).digest('hex');
      const file = join(dir, `${createHash('sha256').update(session.meta.id).digest('hex').slice(0, 32)}.json`);
      await writeFile(file, JSON.stringify({ sessionId: session.meta.id, hash, summary: 'Done.', lessons: [lesson], done: true, ids: [old.meta.id] }));
      const stamp = (await stat(file)).mtimeMs;
      await new Promise(resolve => setTimeout(resolve, 20));
      const retry = await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.', lessons: [lesson] });
      expect(retry.isError).toBe(false);
      expect(retry.text).toContain(old.meta.id);
      expect(await lessonsOf(t.brain)).toHaveLength(2);
      expect((await stat(file)).mtimeMs).toBe(stamp);

      // An arbitrary suffix is not accepted as the record: a fresh session writes its own note.
      const other = await t.brain.openSession('Other', 'pi');
      const otherTag = `session-lesson:${createHash('sha256').update(JSON.stringify([other.meta.id, lesson])).digest('hex').slice(0, 16)}`;
      await t.brain.write({ tier: 'transitive', kind: 'lesson', title: 'Shared title · abcdef', band: 'inferred', source: 'mcp', tags: ['session-lesson', otherTag], links: [other.meta.id],
        body: `${lesson.body}\n\nNoted by the host model when closing session [[${other.meta.id}]]; not verified.`, provenance: { origin: `session:${other.meta.id}` } });
      expect((await t.call('edu_session_close', { id: other.meta.id, summary: 'Done.', lessons: [lesson] })).isError).toBe(false);
      expect(await lessonsOf(t.brain)).toHaveLength(4);
    } finally { await t.close(); }
  });

  it('rejects a well-formed but inconsistent journal without mutating it, the session or the notes', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      const lessons = [{ title: 'L1', body: 'x' }];
      const args = { id: session.meta.id, summary: 'Done.', lessons };
      const dir = join(t.root, 'state', 'session-learning');
      const file = join(dir, `${createHash('sha256').update(session.meta.id).digest('hex').slice(0, 32)}.json`);
      await mkdir(dir, { recursive: true });
      const good = { sessionId: session.meta.id, summary: 'Done.', lessons, done: false, ids: [] as unknown[] };
      const hash = createHash('sha256').update(JSON.stringify({ session: session.meta.id, summary: 'Done.', lessons })).digest('hex');
      const bad: Record<string, unknown>[] = [
        { hash: 'not-the-payload-hash', done: false, ids: [123] },
        { ...good, hash: 'not-the-payload-hash' },
        { ...good, hash, ids: [123] },
        { ...good, hash, sessionId: 'other-session' },
        { ...good, hash, done: true, ids: [] },
        { ...good, hash, summary: 'Changed.' },
        { ...good, hash, lessons: [{ title: 'L1', body: 'x', verified: true }] },
      ];
      for (const journal of bad) {
        const raw = JSON.stringify(journal);
        await writeFile(file, raw);
        const res = await t.call('edu_session_close', args);
        expect(res.isError).toBe(true);
        expect(res.text).toContain('corrupt or inconsistent');
        expect(await readFile(file, 'utf8')).toBe(raw);
        expect((await t.brain.read(session.meta.id))?.meta.status).toBe('open-session');
        expect(await lessonsOf(t.brain)).toHaveLength(0);
      }
      await writeFile(file, JSON.stringify({ ...good, hash }));
      expect((await t.call('edu_session_close', args)).isError).toBe(false);
    } finally { await t.close(); }
  });

  it('documents evidence as existing note ids in the tool schema', async () => {
    const t = await setup();
    try {
      const listed = await (async () => {
        const server = createEduMcpServer({ locations: [t.location] });
        const client = new Client({ name: 'schema', version: '1.0.0' });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(b); await client.connect(a);
        try { return JSON.stringify((await client.listTools()).tools.find(tool => tool.name === 'edu_session_close')); } finally { await client.close(); await server.close(); }
      })();
      expect(listed).toContain('EXISTING brain notes');
      expect(listed).toContain('Not file names');
    } finally { await t.close(); }
  });

  it('records up to 3 unverified candidate lessons that a fresh server shows in the next brief', async () => {
    const t = await setup();
    try {
      const evidence = await t.brain.write({ tier: 'episodic', title: 'Failing run', body: 'log' });
      const session = await t.brain.openSession('Work', 'pi');
      const res = await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.', lessons: three(evidence.meta.id) });
      expect(res.isError).toBe(false);
      expect(res.text).toContain('not verified');
      const notes = await lessonsOf(t.brain);
      expect(notes).toHaveLength(3);
      for (const note of notes) {
        expect(note.meta).toMatchObject({ status: 'candidate', band: 'inferred', origin: `session:${session.meta.id}` });
        expect(note.meta.links).toContain(session.meta.id);
        expect(note.body).toContain('not verified');
        expect(note.meta.usage?.wins ?? 0).toBe(0);
      }
      expect(notes.find(n => n.meta.title.startsWith('Run the focused'))!.body).toContain(`[[${evidence.meta.id}]]`);
      expect((await t.brain.read(session.meta.id))?.meta.status).toBe('closed');
      expect(await t.brain.list({ tier: 'canonical' })).toHaveLength(0);

      const fresh = createEduMcpServer({ locations: [t.location] });
      const client = new Client({ name: 'next', version: '1.0.0' });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await fresh.connect(b); await client.connect(a);
      try {
        const brief = ((await client.callTool({ name: 'edu_brief', arguments: { maxTokens: 1500 } })).content as { text: string }[])[0]!.text;
        expect(brief).toContain('Pin the fixture clock');
        const recall = ((await client.callTool({ name: 'edu_recall', arguments: { query: 'stale lock directory' } })).content as { text: string }[])[0]!.text;
        expect(recall).toContain('Check the lock directory');
      } finally { await client.close(); await fresh.close(); }
    } finally { await t.close(); }
  });

  it('keeps the legacy two-argument close working', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      expect((await t.call('edu_session_close', { id: session.meta.id, summary: 'Plain.' })).isError).toBe(false);
      expect(await lessonsOf(t.brain)).toHaveLength(0);
    } finally { await t.close(); }
  });

  it('an exact retry adds nothing and rewrites nothing; a mismatched payload changes nothing', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      const args = { id: session.meta.id, summary: 'Done.', lessons: three(session.meta.id) };
      await t.call('edu_session_close', args);
      const before = await Promise.all((await lessonsOf(t.brain)).map(async n => [n.meta.id, n.meta.updated, n.body]));
      const closedAt = (await t.brain.read(session.meta.id))!.meta.updated;
      const again = await t.call('edu_session_close', args);
      expect(again.isError).toBe(false);
      expect(again.text).toContain('Already closed');
      const after = await Promise.all((await lessonsOf(t.brain)).map(async n => [n.meta.id, n.meta.updated, n.body]));
      expect(after).toEqual(before);
      expect((await t.brain.read(session.meta.id))!.meta.updated).toBe(closedAt);

      expect((await t.call('edu_session_close', { ...args, lessons: three(session.meta.id).slice(0, 2) })).isError).toBe(true);
      expect((await t.call('edu_session_close', { ...args, summary: 'Other.' })).isError).toBe(true);
      expect((await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.' })).isError).toBe(false); // legacy repeat of the same summary
      expect(await lessonsOf(t.brain)).toHaveLength(3);
      expect((await t.brain.read(session.meta.id))?.body.trim()).toBe('Done.');
    } finally { await t.close(); }
  });

  it('rejects invalid input before any effect', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      const cases: Record<string, unknown>[] = [
        { lessons: [{ title: 'A', body: 'b', evidence: ['no-such-note'] }] },
        { lessons: [...three(session.meta.id), { title: 'Fourth', body: 'x' }] },
        { lessons: [{ title: 'A', body: 'b', verified: true }] },
        { lessons: [{ title: 'x'.repeat(201), body: 'b' }] },
        { lessons: [{ title: 'A', body: 'x'.repeat(2001) }] },
        { lessons: [{ title: 'A', body: 'b', evidence: Array.from({ length: 11 }, () => session.meta.id) }] },
        { lessons: [{ title: 'Same', body: 'one' }, { title: 'Same', body: 'one' }] },
      ];
      for (const extra of cases) expect((await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.', ...extra })).isError).toBe(true);
      expect((await t.brain.read(session.meta.id))?.meta.status).toBe('open-session');
      expect(await lessonsOf(t.brain)).toHaveLength(0);
    } finally { await t.close(); }
  });

  it('refuses lessons for a session closed earlier without them, and respects exact id and source', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      await t.brain.closeSession(session.meta.id, 'Done.');
      const late = await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.', lessons: [{ title: 'Late', body: 'x' }] });
      expect(late.isError).toBe(true);
      expect(late.text).toContain('edu_remember');
      expect(await lessonsOf(t.brain)).toHaveLength(0);
      const other = await t.brain.openSession('Other', 'codex');
      expect((await t.call('edu_session_close', { id: other.meta.id, source: 'pi', summary: 'x', lessons: [{ title: 'L', body: 'x' }] })).isError).toBe(true);
      expect((await t.call('edu_session_close', { id: 'nope', summary: 'x', lessons: [{ title: 'L', body: 'x' }] })).isError).toBe(true);
      expect(await lessonsOf(t.brain)).toHaveLength(0);
    } finally { await t.close(); }
  });

  it('after a partial write failure the session is closed, the error says what is pending, and the exact retry finishes without duplicates', async () => {
    const t = await setup();
    try {
      const session = await t.brain.openSession('Work', 'pi');
      let writes = 0;
      const flaky = new Proxy(t.brain, {
        get(target, prop, receiver) {
          if (prop === 'write') return async (input: Parameters<Brain['write']>[0]) => { if (++writes === 2) throw new Error('disk hiccup'); return target.write(input); };
          return Reflect.get(target, prop, receiver);
        },
      });
      const lessons = three(session.meta.id);
      const current = (await t.brain.read(session.meta.id))!;
      await expect(closeWithLessons(flaky, t.root, current, 'Done.', lessons)).rejects.toThrow(/closed, but 2 of 3 lessons are pending.*disk hiccup.*exact same/s);
      expect((await t.brain.read(session.meta.id))?.meta.status).toBe('closed');
      expect(await lessonsOf(t.brain)).toHaveLength(1);

      const retry = await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.', lessons });
      expect(retry.isError).toBe(false);
      expect(await lessonsOf(t.brain)).toHaveLength(3);
      expect((await t.call('edu_session_close', { id: session.meta.id, summary: 'Done.', lessons: lessons.slice(0, 1) })).isError).toBe(true);
      expect(await lessonsOf(t.brain)).toHaveLength(3);
    } finally { await t.close(); }
  });
});
