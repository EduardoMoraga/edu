import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import { estimateTokens } from '../context/index.js';
import type { CliId, EduEvent, Engine } from '../core/contracts.js';
import { createEduMcpServer, detectCallerCli } from './server.js';
import { createCrewStore } from '../crew/store.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('crew MCP tools', () => {
  it('registers all tools and bounds the status response over InMemoryTransport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-mcp-'));
    roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]);
    await brain.init(location);
    const engine: Engine = {
      cli: 'claude', available: async () => true,
      async *run() { yield { type: 'agent.text', agentId: 'review', text: 'Clear.', at: new Date().toISOString() } satisfies EduEvent; },
    };
    const server = createEduMcpServer({ locations: [location], env: {}, crewOptions: {
      detectClis: async () => ['codex', 'claude'], engineFactory: (_cli: CliId) => engine, diff: async () => 'diff --git a/a b/a',
    } });
    const client = new Client({ name: 'crew-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toEqual(expect.arrayContaining(['edu_crew_dispatch', 'edu_crew_status', 'edu_crew_result', 'edu_crew_artifact', 'edu_crew_review']));
      const status = await client.callTool({ name: 'edu_crew_status', arguments: { maxTokens: 8 } });
      const text = status.content.find(item => item.type === 'text')?.text ?? '';
      expect(status.isError).not.toBe(true);
      expect(text.length).toBeGreaterThan(0);
      expect(estimateTokens(text)).toBeLessThanOrEqual(8);
      const review = await client.callTool({ name: 'edu_crew_review', arguments: { base: 'main', maxTokens: 32 } });
      expect(review.isError).not.toBe(true);
      expect(review.content.find(item => item.type === 'text')?.text).toMatch(/"cli":"(?:codex|claude)"/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('pages a sanitized crew artifact through MCP and rejects invalid offsets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-mcp-')); roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]); await brain.init(location);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'work', mode: 'headless', cwd: root, autonomy: 'ask' });
    await store.update(job.id, { summary: `password=supersecretvalue ${'x'.repeat(2000)}` });
    const server = createEduMcpServer({ locations: [location], env: {}, crewOptions: { brainRoot: root, store } });
    const client = new Client({ name: 'crew-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      let offset: number | null = 0;
      let gathered = '';
      while (offset !== null) {
        const reply = await client.callTool({ name: 'edu_crew_artifact', arguments: { jobId: job.id, kind: 'summary', offset, maxBytes: 700 } });
        expect(reply.isError).not.toBe(true);
        const page = JSON.parse(reply.content.find(item => item.type === 'text')?.text ?? '') as { text: string; nextOffset: number | null; truncated: boolean };
        gathered += page.text;
        offset = page.nextOffset;
      }
      expect(gathered).toContain('x'.repeat(2000));
      expect(gathered).not.toContain('supersecretvalue');
      const invalid = await client.callTool({ name: 'edu_crew_artifact', arguments: { jobId: '../escape', kind: 'summary' } });
      expect(invalid.isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });

  it.each(['EDU_CREW_JOB', 'ALBERT_CREW_JOB'] as const)('keeps %s workers read-only without mutating process.env', async marker => {
    const root = await mkdtemp(join(tmpdir(), 'edu-crew-worker-mcp-')); roots.push(root);
    const location = { scope: 'project' as const, root };
    const brain = openBrain([location]); await brain.init(location);
    const store = createCrewStore(root);
    const job = await store.create({ cli: 'codex', task: 'inspect', mode: 'headless', cwd: root, autonomy: 'readonly' });
    await store.update(job.id, { summary: 'safe result' });
    const server = createEduMcpServer({ locations: [location], env: { [marker]: job.id }, crewOptions: { brainRoot: root, store } });
    const client = new Client({ name: 'crew-worker-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      for (const name of ['edu_remember', 'edu_feedback', 'edu_propose_canonical', 'edu_session_open', 'edu_session_close', 'edu_crew_dispatch', 'edu_crew_review', 'edu_orchestrate', 'edu_crew_approve']) {
        const reply = await client.callTool({ name, arguments: {} });
        expect(reply.isError, name).toBe(true);
        expect(reply.content.find(item => item.type === 'text')?.text, name).toContain('Edu worker cannot call');
      }
      for (const [name, args] of [['edu_crew_status', {}], ['edu_crew_result', { jobId: job.id }], ['edu_crew_artifact', { jobId: job.id, kind: 'summary' }]] as const) {
        const reply = await client.callTool({ name, arguments: args });
        expect(reply.isError, name).not.toBe(true);
      }
    } finally { await client.close(); await server.close(); }
  });

  it('detects caller vendors from host environment hints', () => {
    expect(detectCallerCli({ CLAUDECODE: '1' })).toBe('claude');
    expect(detectCallerCli({ CODEX_SESSION: '1' })).toBe('codex');
    expect(detectCallerCli({ PI_MODEL: 'x' })).toBe('pi');
    expect(detectCallerCli({ OPENCODE: '1' })).toBe('opencode');
    expect(detectCallerCli({})).toBeUndefined();
  });
});
