import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { estimateTokens } from '../context/tokens.js';
import { getCapabilities } from '../release/capabilities.js';
import { packageVersion } from '../cli/package.js';
import { boundedCapabilities } from './capabilities.js';
import { createEduMcpServer } from './server.js';

it('preserves valid JSON and identity for small, default and large MCP budgets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edu-caps-budget-'));
  const source = getCapabilities();
  const server = createEduMcpServer({ locations: [{ root, scope: 'project' }], capabilities: () => JSON.stringify(source) });
  const client = new Client({ name: 'capabilities-budget-contract', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    for (const maxTokens of [128, undefined, 20000]) {
      const result = await client.callTool({ name: 'edu_capabilities', arguments: maxTokens === undefined ? {} : { maxTokens } });
      expect(result.isError).not.toBe(true);
      const text = (result.content as { text: string }[])[0]!.text;
      const parsed = JSON.parse(text);
      expect(parsed).toMatchObject({ version: packageVersion(), toolProfile: 'full', restartRequired: true });
      expect(estimateTokens(text)).toBeLessThanOrEqual(maxTokens ?? 800);
      for (const key of ['features', 'limitations', 'commands'] as const) {
        expect(parsed[key]).toEqual(source[key].slice(0, parsed[key].length));
        expect(parsed.omitted[key]).toBe(source[key].length - parsed[key].length);
      }
      if (maxTokens === 20000) expect(parsed.omitted).toEqual({ features: 0, limitations: 0, commands: 0 });
      else expect(Object.values(parsed.omitted).some(count => Number(count) > 0)).toBe(true);
    }
    for (const maxTokens of [1, 5, 50]) {
      const tiny = await client.callTool({ name: 'edu_capabilities', arguments: { maxTokens } });
      const text = (tiny.content as { text: string }[])[0]!.text;
      const parsed = JSON.parse(text);
      expect(estimateTokens(text)).toBeLessThanOrEqual(maxTokens);
      if (maxTokens === 1) expect(parsed).toBe(0);
      else if (maxTokens === 5) expect(parsed).toEqual({});
      else expect(parsed).toMatchObject({ version: packageVersion(), toolProfile: 'full', restartRequired: true });
      expect(Object(parsed)).not.toHaveProperty('budget');
    }
  } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
});

it('keeps version/profile host-owned and represents legacy provider text inside JSON', () => {
  const parsed = JSON.parse(boundedCapabilities(JSON.stringify({ version: 'spoof', toolProfile: 'full', restartRequired: false, features: ['complete item'] }), 'real', 'memory', 800));
  expect(parsed).toMatchObject({ version: 'real', toolProfile: 'memory', restartRequired: false, features: ['complete item'] });
  expect(JSON.parse(boundedCapabilities('legacy text', 'real', 'full', 800)).features).toEqual(['legacy text']);
});
