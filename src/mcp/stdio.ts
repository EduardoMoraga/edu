import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openBrain } from '../brain/index.js';
import { resolveBrainLocations } from './locations.js';
import { createEduMcpServer } from './server.js';

export interface StdioOptions { cwd?: string; env?: NodeJS.ProcessEnv; now?: Date }

/** Initialize the primary brain and attach the MCP server to stdio. */
export async function runStdioServer(opts: StdioOptions = {}) {
  const locations = await resolveBrainLocations(opts.cwd, opts.env);
  const brain = openBrain(locations);
  await brain.init(locations[0]!);
  const server = createEduMcpServer({ locations, now: opts.now, eduMdPath: join(locations[0]!.root, 'EDU.md') });
  await server.connect(new StdioServerTransport());
  return server;
}
