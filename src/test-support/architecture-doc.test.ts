import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProgram } from '../cli/program.js';
import { createEduMcpServer } from '../mcp/server.js';
import { renderDependencyTable, renderModuleMap } from './architecture.js';

// docs/ARCHITECTURE.md is the 6.0 architecture: its checked tables must match the code.
const DOC = join(import.meta.dirname, '..', '..', 'docs', 'ARCHITECTURE.md');
let doc = '';
let base = '';

beforeAll(async () => {
  doc = (await readFile(DOC, 'utf8')).replace(/\r\n/g, '\n');
  base = await mkdtemp(join(tmpdir(), 'edu-arch-doc-'));
});
afterAll(async () => { await rm(base, { recursive: true, force: true }); });

/** The text between `<!-- generated:<name> -->` and its closing marker. */
function generated(name: string): string | undefined {
  return new RegExp(`<!-- generated:${name} -->\\n([\\s\\S]*?)\\n<!-- /generated:${name} -->`).exec(doc)?.[1];
}

/** The body of the `## ` section whose heading contains `title`. */
function section(title: string): string {
  const start = doc.split('\n').findIndex(line => line.startsWith('## ') && line.includes(title));
  if (start < 0) return '';
  const rest = doc.split('\n').slice(start + 1);
  const end = rest.findIndex(line => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/** Cells of each table row whose first cell is a code span matching `first`. */
function rows(text: string, first: RegExp): string[][] {
  return text.split('\n').filter(line => line.startsWith('| `')).map(line => line.slice(1, -1).split('|').map(cell => cell.trim()))
    .filter(cells => first.test(cells[0]!));
}

async function listTools(profile: 'full' | 'memory'): Promise<Tool[]> {
  const server = createEduMcpServer({ locations: [{ scope: 'global', root: join(base, '.edu') }], env: {}, toolProfile: profile });
  const client = new Client({ name: 'architecture-doc', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools; }
  finally { await client.close(); await server.close(); }
}

const access = (tool: Tool) => tool.annotations?.readOnlyHint ? 'read-only' : tool.annotations?.destructiveHint ? 'destructive' : 'writes';

describe('docs/ARCHITECTURE.md', () => {
  it('renders the allowed dependencies and the module map from the layer table', () => {
    expect(generated('dependencies'), 'paste renderDependencyTable() from src/test-support/architecture.ts').toBe(renderDependencyTable());
    expect(generated('modules'), 'paste renderModuleMap() from src/test-support/architecture.ts').toBe(renderModuleMap());
  });

  it('lists every MCP tool in tools/list order, with its profiles and access', async () => {
    const [full, memory] = await Promise.all([listTools('full'), listTools('memory')]);
    const documented = rows(section('MCP tools'), /^`edu_[a-z_]+`$/).map(([name, profiles, mode]) => ({ name: name!.slice(1, -1), profiles, access: mode }));
    const memoryNames = new Set(memory.map(tool => tool.name));
    expect(documented).toEqual(full.map(tool => ({ name: tool.name, profiles: memoryNames.has(tool.name) ? 'full, memory' : 'full', access: access(tool) })));
    expect(full).toHaveLength(20);
  });

  it('lists exactly the top-level CLI commands', () => {
    const program = createProgram({}, { exitOverride: true });
    const commands = program.commands.filter(command => !(command as unknown as { _hidden?: boolean })._hidden).map(command => command.name());
    const documented = rows(section('CLI commands'), /^`edu [a-z-]+`$/).map(([name]) => name!.slice('`edu '.length, -1));
    expect([...documented].sort()).toEqual([...commands].sort());
    expect(new Set(documented).size).toBe(documented.length);
  });

  it('drops the v0.1 spec framing and the crew ownership column', () => {
    expect(doc).not.toMatch(/v0\.1 spec|Owner \(crew role\)/);
  });
});
