import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openBrain } from '../brain/index.js';
import { resolveBrainLocations } from './locations.js';
import { createEduMcpServer } from './server.js';

export interface StdioOptions { cwd?: string; env?: NodeJS.ProcessEnv; now?: Date }

/** Initialize the primary brain and attach the MCP server to stdio. */
export async function runStdioServer(opts: StdioOptions = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? launchDirectory(env);
  const locations = await resolveBrainLocations(cwd, env);
  const brain = openBrain(locations);
  await brain.init(locations[0]!);
  const server = createEduMcpServer({
    locations,
    now: opts.now,
    eduMdPath: join(locations[0]!.root, 'EDU.md'),
    resolveLocations: async (mcp) => {
      if (!mcp.server.getClientCapabilities()?.roots) return undefined;
      const { roots } = await mcp.server.listRoots();
      const root = roots.find(r => r.uri.startsWith('file://'));
      if (!root) return undefined;
      const dir = fileURLToPath(root.uri);
      return resolve(dir) === resolve(cwd) ? undefined : resolveBrainLocations(dir, env);
    },
  });
  await server.connect(new StdioServerTransport());
  return server;
}

/** Some CLIs spawn MCP servers from their plugin folder; the inherited PWD still names the user's shell directory. */
export function launchDirectory(env: NodeJS.ProcessEnv, processCwd = process.cwd()): string {
  const pwd = env.PWD;
  if (pwd && resolve(pwd) !== resolve(processCwd) && existsSync(pwd) && statSync(pwd).isDirectory() && /[\\/]plugins?[\\/]/.test(processCwd)) return pwd;
  return processCwd;
}
