import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { expect, it } from 'vitest';
import { openBrain } from '../brain/brain.js';
import { packageVersion } from '../cli/package.js';
import { createStdioServer } from './stdio.js';

it('host-owned workspace keeps brief, MCP and capabilities aligned despite overrides or a project-use request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edu-host-workspace-'));
  const a = join(root, 'a'), b = join(root, 'b');
  let client: Client | undefined;
  try {
    for (const [cwd, marker] of [[a, 'HOST_A'], [b, 'HOST_B']]) {
      const location = { scope: 'project' as const, root: join(cwd!, '.edu') };
      await openBrain([location]).init(location);
      await writeFile(join(location.root, 'EDU.md'), `# ${marker}\nOnly this host workspace.\n`);
    }
    const server = await createStdioServer({ cwd: a, env: {
      HOME: join(root, 'home'), EDU_HOME: join(root, 'global'), EDU_CEILING_DIRECTORIES: root,
      EDU_PROJECT: b, EDU_LOCK_WORKSPACE: '1',
    } });
    client = new Client({ name: 'pinned-host', version: '1' }, { capabilities: { roots: {} } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(b).href }] }));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st); await client.connect(ct);
    const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as Array<{ type: string; text?: string }>).filter(row => row.type === 'text').map(row => row.text).join('\n');
    const first = await client.callTool({ name: 'edu_brief', arguments: {} });
    expect(text(first)).toContain('HOST_A'); expect(text(first)).not.toContain('HOST_B');
    const switched = await client.callTool({ name: 'edu_project_use', arguments: { workspace: b } });
    expect(switched.isError).toBe(true); expect(text(switched)).toContain('host owns this workspace');
    expect(text(await client.callTool({ name: 'edu_brief', arguments: {} }))).toContain('HOST_A');
    const caps = await client.callTool({ name: 'edu_capabilities', arguments: { version: '999.0.0' } });
    const info = JSON.parse(text(caps));
    expect(info.version).toBe(packageVersion()); expect(info.restartRequired).toBe(true);
    expect(info.version).not.toBe('999.0.0');
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }); }
});
