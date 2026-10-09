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
    const server = createEduMcpServer({ locations: [location], crewOptions: {
      detectClis: async () => ['codex', 'claude'], engineFactory: (_cli: CliId) => engine, diff: async () => 'diff --git a/a b/a',
    } });
    const client = new Client({ name: 'crew-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map(tool => tool.name);
      expect(names).toEqual(expect.arrayContaining(['edu_crew_dispatch', 'edu_crew_status', 'edu_crew_result', 'edu_crew_review']));
      const status = await client.callTool({ name: 'edu_crew_status', arguments: { maxTokens: 8 } });
      const text = status.content.find(item => item.type === 'text')?.text ?? '';
      expect(status.isError).not.toBe(true);
      expect(text.length).toBeGreaterThan(0);
      expect(estimateTokens(text)).toBeLessThanOrEqual(8);
      const review = await client.callTool({ name: 'edu_crew_review', arguments: { base: 'main', maxTokens: 32 } });
      expect(review.isError).not.toBe(true);
      expect(review.content.find(item => item.type === 'text')?.text).toContain('"cli":"codex"');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('detects caller vendors from host environment hints', () => {
    expect(detectCallerCli({ CLAUDECODE: '1' })).toBe('claude');
    expect(detectCallerCli({ CODEX_SESSION: '1' })).toBe('codex');
    expect(detectCallerCli({ PI_MODEL: 'x' })).toBe('pi');
    expect(detectCallerCli({ OPENCODE: '1' })).toBe('opencode');
    expect(detectCallerCli({})).toBeUndefined();
  });
});
