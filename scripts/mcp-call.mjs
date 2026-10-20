#!/usr/bin/env node
// Development-only stdio bridge for real-model pilots. It never calls a model itself.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const [projectArg, tool, jsonFile] = process.argv.slice(2);
if (!projectArg || !tool || !jsonFile) throw new Error('Usage: node scripts/mcp-call.mjs <fixture-project> <tool> <arguments.json>');
const project = resolve(projectArg);
const client = new Client({ name: 'edu-development-pilot', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp', '--project', project], cwd: project,
  env: { ...process.env, HOME: join(project, 'home'), EDU_HOME: join(project, 'global'), EDU_PROJECT: project, EDU_CEILING_DIRECTORIES: project }, stderr: 'pipe' });
try {
  await client.connect(transport);
  const result = await client.callTool({ name: tool, arguments: JSON.parse(await readFile(resolve(jsonFile), 'utf8')) });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} finally { await client.close(); await transport.close(); }
