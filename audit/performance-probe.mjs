// Local-only probe: no model calls, credentials, or changes to the user's brain.
// Run from the repository root: node audit/performance-probe.mjs
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = await mkdtemp(join(tmpdir(), 'edu-cost-audit-'));
const cli = resolve('dist/cli.js');
const env = { ...process.env, HOME: root, EDU_HOME: join(root, '.edu'), EDU_PROJECT: '' };
// Same heuristic as src/context/tokens.ts; NOT Kimi tokenization or billable usage.
const estimate = text => Math.ceil((text.length - [...text.matchAll(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu)].length) / 3.7
  + [...text.matchAll(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu)].length * 0.9
  + [...text.matchAll(/[{}()[\];:=+*/<>|&!?#$%^~\\]/gu)].length * 0.23);
const size = text => ({ bytes: Buffer.byteLength(text), estimatedTokens: estimate(text) });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, env, input: '', encoding: 'utf8' });
const client = new Client({ name: 'edu-local-cost-audit', version: '1' });
let transport;
try {
  run('init', '--cli', 'pi');
  transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', root], cwd: root, env, stderr: 'pipe' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const schemas = JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
  const textOf = result => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  const coldStart = performance.now();
  const coldBrief = run('hook', 'session-start').trim();
  const coldMs = performance.now() - coldStart;
  const mcpBrief = textOf(await client.callTool({ name: 'edu_brief', arguments: {} }));
  for (let i = 0; i < 32; i++) {
    const result = await client.callTool({ name: 'edu_remember', arguments: {
      tier: 'transitive', kind: 'lesson', title: `Synthetic lesson ${String(i).padStart(2, '0')}: check evidence before changing configuration`,
      body: 'Synthetic audit fixture, not an actual lesson.', band: 'hypothesis',
    } });
    if (result.isError) throw new Error(textOf(result));
  }
  const repeated = [];
  for (let i = 0; i < 4; i++) {
    const started = performance.now();
    const text = run('hook', 'session-start').trim();
    repeated.push({ ...size(text), milliseconds: Math.round(performance.now() - started), sha256: createHash('sha256').update(text).digest('hex') });
  }
  const longWrite = await client.callTool({ name: 'edu_remember', arguments: {
    tier: 'transitive', kind: 'lesson', title: 'Long single-paragraph audit fixture', body: 'Evidence sentence. '.repeat(1000),
  } });
  const longId = textOf(longWrite).match(/^Created (\S+)/)?.[1];
  if (!longId || longWrite.isError) throw new Error(textOf(longWrite));
  const longRead = textOf(await client.callTool({ name: 'edu_read', arguments: { id: longId } }));
  const identity = await readFile('templates/EDU.md', 'utf8');
  console.log(JSON.stringify({
    note: 'Local structural estimates only. Tool exposure and provider serialization depend on the host; no Kimi A/B or billing measurement.',
    node: process.version,
    tools: { count: tools.length, names: tools.map(t => t.name), schemaPayload: size(schemas) },
    templateIdentity: size(identity),
    freshHookBrief: { ...size(coldBrief), milliseconds: Math.round(coldMs) },
    freshMcpBrief: size(mcpBrief),
    synthetic32LessonsHookBriefs: repeated,
    longSingleParagraphRead: { ...size(longRead), includesBody: longRead.includes('Evidence sentence.'), preview: longRead.replaceAll(longId, '<note-id>') },
  }, null, 2));
} finally {
  await client.close().catch(() => {});
  await transport?.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
