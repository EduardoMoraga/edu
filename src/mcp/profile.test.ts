import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { createEduMcpServer } from './server.js';
import { createStdioServer } from './stdio.js';

it('offers an explicit smaller memory surface while keeping full as the compatible default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edu-mcp-profile-'));
  const clients: Client[] = [];
  try {
    const connect = async (toolProfile?: 'memory' | 'full') => {
      const server = createEduMcpServer({ locations: [{ root, scope: 'project' }], toolProfile });
      const client = new Client({ name: 'profile-contract', version: '1' }); clients.push(client);
      const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
      return client;
    };
    const full = await connect(); const memory = await connect('memory');
    const a = (await full.listTools()).tools, b = (await memory.listTools()).tools;
    expect(a).toHaveLength(18); expect(b).toHaveLength(12);
    expect(b.map(tool => tool.name)).toContain('edu_session_close');
    expect(b.map(tool => tool.name)).toContain('edu_capabilities');
    expect(b.every(tool => !tool.name.startsWith('edu_crew_') && tool.name !== 'edu_orchestrate')).toBe(true);
    expect(JSON.stringify(b).length).toBeLessThan(JSON.stringify(a).length);
    const result = await memory.callTool({ name: 'edu_capabilities', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('memory profile');
    const explicit = await connect('full');
    expect((await explicit.listTools()).tools.map(tool => tool.name)).toEqual(a.map(tool => tool.name));
  } finally { await Promise.all(clients.map(client => client.close())); await rm(root, { recursive: true, force: true }); }
});

it('rejects unknown profiles rather than silently expanding the tool surface', async () => {
  expect(() => createEduMcpServer({ locations: [{ root: '/not-written', scope: 'project' }], toolProfile: 'typo' as never })).toThrow('Unknown MCP tool profile');
  await expect(createStdioServer({ env: { EDU_MCP_PROFILE: 'typo' } })).rejects.toThrow('Unknown MCP tool profile');
});
