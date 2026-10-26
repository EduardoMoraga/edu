import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { estimateTokens } from '../context/index.js';
import { packageVersion } from '../cli/package.js';
import { createEduMcpServer } from './server.js';

// These tests exercise a regular host even when the test runner itself was
// launched by an Edu worker. Worker behavior is covered in crew.test.ts.
const normalServer = (options: Parameters<typeof createEduMcpServer>[0]) => createEduMcpServer({ env: {}, ...options });

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('Edu MCP tools', () => {
  it('exercises every tool through a linked client/server and bounds responses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-mcp-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const server = normalServer({ locations: [location], now: new Date('2026-10-08T00:00:00Z') });
    const client = new Client({ name: 'edu-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      return { result, text: result.content.filter(item => item.type === 'text').map(item => item.text).join('') };
    };
    try {
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toEqual(expect.arrayContaining(['edu_brief', 'edu_recall', 'edu_read', 'edu_remember', 'edu_feedback', 'edu_propose_canonical', 'edu_commitments', 'edu_session_open', 'edu_session_close']));
      const remembered = await call('edu_remember', { tier: 'transitive', kind: 'commitment', title: 'Ship release', body: 'Prepare the release.', due: '2026-10-09' });
      expect(remembered.result.isError).not.toBe(true);
      const note = (await brain.list({ kind: 'commitment' }))[0]!;
      expect((await call('edu_commitments')).text).toContain('Ship release');
      expect((await call('edu_recall', { query: 'release' })).text).toContain(`${note.meta.id} ·`);
      expect((await call('edu_read', { id: note.meta.id })).text).toContain('Prepare the release.');
      expect((await call('edu_feedback', { id: note.meta.id, helpful: true })).result.isError).not.toBe(true);
      expect((await brain.read(note.meta.id))?.meta.usage?.wins).toBe(1);
      expect((await call('edu_propose_canonical', { kind: 'standard', title: 'Release standard', body: 'Check release.' })).result.isError).not.toBe(true);
      expect((await brain.list({ tier: 'canonical' }))[0]?.meta.status).toBe('proposed');
      expect((await call('edu_session_open', { title: 'Release session', source: 'test' })).result.isError).not.toBe(true);
      const session = (await brain.list({ kind: 'session' }))[0]!;
      expect((await call('edu_session_close', { id: session.meta.id, summary: 'Finished.' })).result.isError).not.toBe(true);
      expect((await brain.read(session.meta.id))?.meta.status).toBe('closed');
      expect((await call('edu_brief')).text).toContain('Ship release');
      for (const name of ['edu_brief', 'edu_recall', 'edu_read', 'edu_commitments']) {
        const args = name === 'edu_recall' ? { query: 'release', maxTokens: 12 } : name === 'edu_read' ? { id: note.meta.id, maxTokens: 12 } : { maxTokens: 12 };
        expect(estimateTokens((await call(name, args)).text)).toBeLessThanOrEqual(12);
      }
      await brain.write({ tier: 'transitive', kind: 'decision', title: 'Usar colas', body: 'Queue body.', provenance: { legacy_id: 'D-010', aliases: ['D-010'] } });
      await brain.write({ tier: 'transitive', kind: 'decision', title: 'Usar caché', body: 'Cache body.', provenance: { legacy_id: 'D-011', aliases: ['D-011'] } });
      expect((await call('edu_read', { id: 'D-010' })).text).toContain('Queue body.');
      expect((await call('edu_read', { id: 'usar CACHE' })).text).toContain('Cache body.');
      const ambiguous = await call('edu_read', { id: 'D-01' });
      expect(ambiguous.result.isError).not.toBe(true);
      expect(ambiguous.text).toMatch(/Ambiguous reference "D-01" \(prefix\)[\s\S]*D-010-usar-colas[\s\S]*D-011-usar-cache/);
      const missing = await call('edu_read', { id: 'missing' });
      expect(missing.result.isError).toBe(true);
      expect(missing.text).toContain('Note not found');
      for (const [name, args] of [
        ['edu_read', { id: 123, maxTokens: 1 }],
        ['edu_recall', { query: 123, maxTokens: 1 }],
        ['edu_feedback', { id: 123, helpful: true, maxTokens: 1 }],
        ['edu_remember', { tier: 'invalid', title: 'Bad', body: 'Bad', maxTokens: 1 }],
        ['edu_propose_canonical', { kind: 'invalid', title: 'Bad', body: 'Bad', maxTokens: 1 }],
        ['edu_commitments', { status: 'invalid', maxTokens: 1 }],
        ['edu_session_open', { title: 123, maxTokens: 1 }],
        ['edu_session_close', { id: 123, summary: 'Bad', maxTokens: 1 }],
      ] as const) {
        const invalid = await call(name, args);
        expect(invalid.result.isError).toBe(true);
        expect(estimateTokens(invalid.text)).toBeLessThanOrEqual(1);
      }
      const invalidLimit = await call('edu_brief', { maxTokens: 'invalid' });
      expect(invalidLimit.result.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('workspace binding', () => {
  it('shares one rebound bind across concurrent first tool calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-concurrent-bind-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    await openBrain([location]).init(location);
    let binds = 0;
    const server = normalServer({ locations: [location], resolveLocations: async () => {
      binds++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return [location];
    } });
    const client = new Client({ name: 'edu-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      await Promise.all([
        client.callTool({ name: 'edu_brief', arguments: {} }),
        client.callTool({ name: 'edu_commitments', arguments: {} }),
      ]);
      expect(binds).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rebinds to the brain of the client root before the first tool call', async () => {
    const pluginDir = await mkdtemp(join(tmpdir(), 'edu-plugin-'));
    const project = await mkdtemp(join(tmpdir(), 'edu-project-'));
    roots.push(pluginDir, project);
    const wrong = { scope: 'project' as const, root: pluginDir };
    const right = { scope: 'project' as const, root: project };
    await openBrain([wrong]).init(wrong);
    const projectBrain = openBrain([right]);
    await projectBrain.init(right);
    await projectBrain.write({ title: 'Prefer small pull requests', body: 'Small PRs', tier: 'transitive', kind: 'lesson' });
    const server = normalServer({
      locations: [wrong],
      resolveLocations: async (mcp) => {
        const { roots: listed } = await mcp.server.listRoots();
        return listed[0]?.uri === `file://${project}` ? [right] : undefined;
      },
    });
    const client = new Client({ name: 'edu-test', version: '1.0.0' }, { capabilities: { roots: {} } });
    client.setRequestHandler((await import('@modelcontextprotocol/sdk/types.js')).ListRootsRequestSchema, async () => ({ roots: [{ uri: `file://${project}`, name: 'project' }] }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: 'edu_recall', arguments: { query: 'pull requests' } });
      const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('');
      expect(text).toContain('Prefer small pull requests');
    } finally {
      await client.close();
    }
  });
});

describe('tool annotations', () => {
  it('marks reads read-only and agent-starting tools as needing approval', async () => {
    const { TOOL_ANNOTATIONS } = await import('./server.js');
    expect(TOOL_ANNOTATIONS.edu_recall?.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.edu_remember).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(TOOL_ANNOTATIONS.edu_crew_dispatch).toMatchObject({ destructiveHint: true, openWorldHint: true });
    const root = await mkdtemp(join(tmpdir(), 'edu-ann-'));
    roots.push(root);
    const server = normalServer({ locations: [{ scope: 'project', root }] });
    const client = new Client({ name: 'edu-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    const { tools } = await client.listTools();
    expect(tools.find(t => t.name === 'edu_crew_dispatch')?.annotations?.destructiveHint).toBe(true);
    expect(tools.every(t => t.annotations)).toBe(true);
    await client.close();
  });
});

describe('caller detection', () => {
  it('prefers the MCP client name and falls back to environment hints', async () => {
    const { detectCallerCli } = await import('./server.js');
    expect(detectCallerCli({}, 'antigravity-cli')).toBe('agy');
    expect(detectCallerCli({}, 'claude-code')).toBe('claude');
    expect(detectCallerCli({}, 'codex-mcp-client')).toBe('codex');
    expect(detectCallerCli({ OPENCODE: '1' })).toBe('opencode');
    expect(detectCallerCli({})).toBeUndefined();
  });
});

async function connected(location: { scope: 'project'; root: string }, extra: Partial<Parameters<typeof createEduMcpServer>[0]> = {}) {
  const server = normalServer({ locations: [location], ...extra });
  const client = new Client({ name: 'edu-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe('session id recovery', () => {
  it('advertises the id first and never closes another session for an unknown id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-session-recovery-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const server = normalServer({ locations: [location] });
    const client = new Client({ name: 'edu-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const opened = await client.callTool({ name: 'edu_session_open', arguments: { title: 'Work', source: 'codex' } });
      const text = opened.content.find(item => item.type === 'text')?.text ?? '';
      const id = (await brain.list({ kind: 'session' }))[0]!.meta.id;
      expect(text.startsWith(`Session id: ${id}`)).toBe(true);
      const wrong = await client.callTool({ name: 'edu_session_close', arguments: { id: 'wrong', summary: 'Finished.' } });
      expect(wrong.isError).toBe(true);
      expect(wrong.content.find(item => item.type === 'text')?.text).toContain(id);
      expect((await brain.read(id))?.meta.status).toBe('open-session');
      const closed = await client.callTool({ name: 'edu_session_close', arguments: { id, summary: 'Finished.' } });
      expect(closed.isError).not.toBe(true);
      expect((await brain.read(id))?.meta.status).toBe('closed');
      const empty = await client.callTool({ name: 'edu_session_close', arguments: { id: 'missing', summary: 'Again.' } });
      expect(empty.isError).toBe(true);
      expect(empty.content.find(item => item.type === 'text')?.text).toContain('Open session ids: none');
    } finally { await client.close(); await server.close(); }
  });

  it('auto-maintains the brain after edu_session_close after a close, throttled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-session-maintain-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    await brain.write({ title: 'Late promise', body: '', tier: 'transitive', kind: 'commitment', due: '2020-01-01' });
    const server = normalServer({ locations: [location] });
    const client = new Client({ name: 'edu-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      await client.callTool({ name: 'edu_session_open', arguments: { title: 'Work', source: 'codex' } });
      const first = (await brain.list({ kind: 'session', status: 'open-session' }))[0]!.meta.id;
      const closed = await client.callTool({ name: 'edu_session_close', arguments: { id: first, summary: 'Finished.' } });
      expect(closed.isError).not.toBe(true);
      const state = JSON.parse(await readFile(join(root, 'state', 'maintain.json'), 'utf8'));
      expect(state).toMatchObject({ overdue: 1, changed: 1, promoted: 0, retired: 0 });
      expect(await readFile(join(root, 'brain', '0-index', 'INDEX.md'), 'utf8')).toContain('Late promise');
      expect((await brain.list({ kind: 'commitment' }))[0]?.meta.status).toBe('overdue');
      await client.callTool({ name: 'edu_session_open', arguments: { title: 'Again', source: 'codex' } });
      const id = (await brain.list({ kind: 'session', status: 'open-session' }))[0]!.meta.id;
      expect((await client.callTool({ name: 'edu_session_close', arguments: { id, summary: 'Done.' } })).isError).not.toBe(true);
      expect(JSON.parse(await readFile(join(root, 'state', 'maintain.json'), 'utf8')).lastRun).toBe(state.lastRun);
    } finally { await client.close(); await server.close(); }
  });

  it('does not close a session of another source, nor pick one by source when the id is unknown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-session-source-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const first = await brain.openSession('First', 'codex');
    const second = await brain.openSession('Second', 'claude');
    const { client, close } = await connected(location);
    try {
      const unknown = await client.callTool({ name: 'edu_session_close', arguments: { id: 'unknown', source: 'claude', summary: 'Done' } });
      expect(unknown.isError).toBe(true);
      const foreign = await client.callTool({ name: 'edu_session_close', arguments: { id: first.meta.id, source: 'claude', summary: 'Done' } });
      expect(foreign.isError).toBe(true);
      expect((await brain.read(first.meta.id))?.meta.status).toBe('open-session');
      expect((await brain.read(second.meta.id))?.meta.status).toBe('open-session');
      expect((await client.callTool({ name: 'edu_session_close', arguments: { id: second.meta.id, source: 'claude', summary: 'Done' } })).isError).not.toBe(true);
    } finally { await close(); }
  });

  it('reuses the open session with the same source and title, and keeps different ones apart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-session-reuse-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const { client, close } = await connected(location);
    try {
      const open = (title: string, source: string) => client.callTool({ name: 'edu_session_open', arguments: { title, source } });
      await open('Work', 'codex'); await open('Work', 'codex');
      expect(await brain.list({ kind: 'session' })).toHaveLength(1);
      await open('Work', 'claude'); await open('Other', 'codex');
      expect(await brain.list({ kind: 'session' })).toHaveLength(3);
      const id = (await brain.list({ kind: 'session', source: 'codex', status: 'open-session' })).find(n => n.meta.title === 'Work')!.meta.id;
      await client.callTool({ name: 'edu_session_close', arguments: { id, summary: 'Done' } });
      await open('Work', 'codex');
      expect(await brain.list({ kind: 'session' })).toHaveLength(4);
    } finally { await close(); }
  });

  it('concurrent opens of the same source and title yield one session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-session-race-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const a = await connected(location); const b = await connected(location);
    try {
      const open = (c: typeof a) => c.client.callTool({ name: 'edu_session_open', arguments: { title: 'Race', source: 'pi' } });
      const results = await Promise.all([open(a), open(b), open(a), open(b), open(a)]);
      expect(results.every(r => !r.isError)).toBe(true);
      expect(await brain.list({ kind: 'session' })).toHaveLength(1);
    } finally { await a.close(); await b.close(); }
  });

  it('concurrent identical closes all succeed with one write; a mismatched summary mutates nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-close-race-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const session = await brain.openSession('Work', 'pi');
    const a = await connected(location); const b = await connected(location);
    try {
      const closeWith = (c: typeof a, summary: string) => c.client.callTool({ name: 'edu_session_close', arguments: { id: session.meta.id, summary } });
      const same = await Promise.all([closeWith(a, 'Same'), closeWith(b, 'Same'), closeWith(a, 'Same'), closeWith(b, 'Same'), closeWith(a, 'Same')]);
      expect(same.map(r => r.isError ?? false)).toEqual([false, false, false, false, false]);
      const texts = same.map(r => (r.content as { text: string }[])[0]!.text);
      expect(texts.filter(t => t.startsWith('Closed '))).toHaveLength(1);
      expect(texts.filter(t => t.startsWith('Already closed '))).toHaveLength(4);
      expect((await closeWith(b, 'Other')).isError).toBe(true);
      expect((await brain.read(session.meta.id))?.body.trim()).toBe('Same');
    } finally { await a.close(); await b.close(); }
  });

  it('two concurrent closes with different summaries: exactly one Closed, one error, the confirmed summary persists', async () => {
    for (const shared of [true, false]) {
      const root = await mkdtemp(join(tmpdir(), 'edu-close-diff-'));
      roots.push(root);
      const location = { scope: 'project' as const, root };
      const brain = openBrain([location]);
      await brain.init(location);
      const session = await brain.openSession('Work', 'pi');
      const a = await connected(location); const b = shared ? a : await connected(location);
      try {
        const closeWith = (c: typeof a, summary: string) => c.client.callTool({ name: 'edu_session_close', arguments: { id: session.meta.id, summary } });
        const [one, two] = await Promise.all([closeWith(a, 'SUMMARY ONE'), closeWith(b, 'SUMMARY TWO')]);
        const text = (r: typeof one) => (r.content as { text: string }[])[0]!.text;
        const winner = [one, two].filter(r => !r.isError);
        const loser = [one, two].filter(r => r.isError);
        expect(winner).toHaveLength(1);
        expect(loser).toHaveLength(1);
        expect(text(winner[0]!)).toMatch(/^Closed /);
        expect(text(loser[0]!)).toContain('different summary');
        expect((await brain.read(session.meta.id))?.body.trim()).toBe(winner[0] === one ? 'SUMMARY ONE' : 'SUMMARY TWO');
      } finally { await a.close(); if (b !== a) await b.close(); }
    }
  });

  it('repeating the same close is ok; a different summary leaves the closed session unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-session-idempotent-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const session = await brain.openSession('Work', 'codex');
    const { client, close } = await connected(location);
    try {
      const closeWith = (summary: string) => client.callTool({ name: 'edu_session_close', arguments: { id: session.meta.id, summary } });
      expect((await closeWith('First summary')).isError).not.toBe(true);
      const repeated = await closeWith('First summary');
      expect(repeated.isError).not.toBe(true);
      const different = await closeWith('Second summary');
      expect(different.isError).toBe(true);
      expect((await brain.read(session.meta.id))?.body.trim()).toBe('First summary');
    } finally { await close(); }
  });
});

describe('published tool schemas', () => {
  it('keep declared required fields, mark optional ones optional and carry no null defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-schema-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    await openBrain([location]).init(location);
    const { client, close } = await connected(location);
    try {
      const tools = (await client.listTools()).tools;
      const required = Object.fromEntries(tools.map(tool => [tool.name, tool.inputSchema.required ?? []]));
      expect(required.edu_recall).toEqual(['query']);
      expect(required.edu_read).toEqual(['id']);
      expect(required.edu_session_close).toEqual(['id', 'summary']);
      expect(required.edu_session_open).toEqual(['title']);
      expect(required.edu_feedback).toEqual(['id', 'helpful']);
      expect(required.edu_brief).toEqual([]);
      const recall = tools.find(tool => tool.name === 'edu_recall')!.inputSchema.properties as Record<string, { type?: string }>;
      expect(Object.keys(recall)).toEqual(['query', 'limit', 'tiers', 'maxTokens']);
      expect(recall.maxTokens?.type).toBe('integer');
      expect(JSON.stringify(tools)).not.toMatch(/"default":/);
      // Malformed arguments still produce a bounded error, not a protocol failure.
      const bad = await client.callTool({ name: 'edu_recall', arguments: { query: 5, maxTokens: 20 } });
      expect(bad.isError).toBe(true);
      expect(estimateTokens((bad.content as { text: string }[])[0]!.text)).toBeLessThanOrEqual(20);
    } finally { await close(); }
  });
});

describe('edu_read paging', () => {
  it('pages a long note within maxTokens and reaches every character', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-read-page-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const body = Array.from({ length: 400 }, (_, i) => `line ${i} of the long note`).join('\n');
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Long note', body });
    const { client, close } = await connected(location);
    try {
      let offset = 0; let rebuilt = ''; let pages = 0;
      for (; pages < 100; pages++) {
        const res = await client.callTool({ name: 'edu_read', arguments: { id: note.meta.id, offset, maxTokens: 300 } });
        const text = (res.content as { type: string; text: string }[])[0]!.text;
        expect(estimateTokens(text)).toBeLessThanOrEqual(300);
        const hint = /\[chars (\d+)-(\d+) of (\d+); continue with edu_read id=\S+ offset=(\d+)\]$/.exec(text);
        const tail = /\n\n\[chars [^\]]*\]$/.exec(text);
        const piece = text.slice(text.indexOf('\n\n') + 2, tail?.index);
        rebuilt += piece;
        if (!hint) break;
        expect(Number(hint[1])).toBe(offset);
        offset = Number(hint[4]);
      }
      expect(pages).toBeGreaterThan(1);
      expect(rebuilt.trim()).toBe(body.trim());
      const small = await client.callTool({ name: 'edu_read', arguments: { id: note.meta.id, offset: 0, limit: 50, maxTokens: 800 } });
      expect((small.content as { text: string }[])[0]!.text).toContain('offset=50]');
    } finally { await close(); }
  });

  it('returns a short note unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-read-short-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Short', body: 'tiny body' });
    const { client, close } = await connected(location);
    try {
      const res = await client.callTool({ name: 'edu_read', arguments: { id: note.meta.id } });
      expect((res.content as { text: string }[])[0]!.text).toMatch(/tiny body$/);
    } finally { await close(); }
  });
});

describe('edu_capabilities and advisory feedback', () => {
  it('answers without overclaiming and uses the injected provider, ignoring any version the caller claims', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-caps-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    await openBrain([location]).init(location);
    const plain = await connected(location);
    try {
      const text = ((await plain.client.callTool({ name: 'edu_capabilities', arguments: {} })).content as { text: string }[])[0]!.text;
      expect(JSON.parse(text)).toMatchObject({ version: packageVersion(), toolProfile: 'full', restartRequired: true });
      const spoof = ((await plain.client.callTool({ name: 'edu_capabilities', arguments: { version: '999.0.0', wantedVersion: '999.0.0' } })).content as { text: string }[])[0]!.text;
      expect(spoof).toBe(text);
      expect(spoof).not.toContain('999');
      expect(plain.client.getServerVersion()?.version).toBe(packageVersion());
      expect(text).toContain('not model training');
    } finally { await plain.close(); }
    const injected = await connected(location, { capabilities: () => `caps for ${packageVersion()}` });
    try {
      const text = ((await injected.client.callTool({ name: 'edu_capabilities', arguments: { version: '2.0.0' } })).content as { text: string }[])[0]!.text;
      expect(JSON.parse(text)).toMatchObject({ version: packageVersion(), features: [`caps for ${packageVersion()}`] });
    } finally { await injected.close(); }
  });

  it('ignores a verified claim on edu_feedback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-advisory-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Advice', body: 'x' });
        const { client, close } = await connected(location);
    try {
      const res = await client.callTool({ name: 'edu_feedback', arguments: { id: note.meta.id, helpful: true, verified: true, eventId: 'e1' } });
      expect(res.isError).not.toBe(true);
      expect(JSON.stringify((await brain.read(note.meta.id))?.meta)).not.toContain('verified');
    } finally { await close(); }
  });
});
