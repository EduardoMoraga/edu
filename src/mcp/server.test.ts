import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { estimateTokens } from '../context/index.js';
import { createEduMcpServer } from './server.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('Edu MCP tools', () => {
  it('exercises every tool through a linked client/server and bounds responses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-mcp-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const server = createEduMcpServer({ locations: [location], now: new Date('2026-10-08T00:00:00Z') });
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
    const server = createEduMcpServer({
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
    const server = createEduMcpServer({ locations: [{ scope: 'project', root }] });
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
