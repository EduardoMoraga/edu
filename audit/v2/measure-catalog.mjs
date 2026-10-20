// Dev-only structural measurement. Run after `npm run build`; never calls a model.
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { estimateTokens } from '../../src/context/tokens.ts';
const root = await realpath(await mkdtemp(join(tmpdir(), 'edu-catalog-')));
try {
  await mkdir(join(root, '.edu'), { recursive: true });
  await writeFile(join(root, '.edu/config.json'), JSON.stringify({ version: 1, brainDir: 'brain' }));
  const rows = [];
  for (const profile of ['full', 'memory']) {
    const client = new Client({ name: 'catalog-measurement', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp', '--project', root, '--profile', profile], cwd: root,
      env: { ...process.env, HOME: join(root, 'home'), EDU_HOME: join(root, 'global'), EDU_PROJECT: root, EDU_CEILING_DIRECTORIES: root }, stderr: 'pipe' });
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      const serialized = JSON.stringify(tools);
      rows.push({ profile, toolCount: tools.length, serializedUtf8Bytes: Buffer.byteLength(serialized), estimatedCatalogTokens: estimateTokens(serialized), names: tools.map(t => t.name) });
    } finally { await client.close(); await transport.close(); }
  }
  console.log(JSON.stringify({ kind: 'mcp-catalog-structural-measurement', version: '2.0.0-rc.1', rows,
    modelCalls: 0, billedCostUsd: null,
    limitations: ['Measures serialized listTools, not a provider request or invoice.', 'Token counts are the local heuristic, not provider usage.', 'Deferred tools and prompt caching can change actual cost.', 'Memory still adds tools versus native-clean; no net savings are established.'] }, null, 2));
} finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
