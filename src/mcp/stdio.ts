import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openBrain } from '../brain/index.js';
import type { BrainLocation } from '../core/contracts.js';
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
      return resolveReboundLocations(cwd, env, async () => (await mcp.server.listRoots()).roots.map(root => root.uri));
    },
  });
  await server.connect(new StdioServerTransport());
  return server;
}

/** Resolve the client's workspace and initialize its brain before exposing it to tool calls. */
export async function resolveReboundLocations(
  cwd: string, env: NodeJS.ProcessEnv, listRoots: () => Promise<string[]>,
): Promise<BrainLocation[] | undefined> {
  let roots: string[];
  try { roots = await listRoots(); }
  catch { roots = await listRoots(); }
  const uri = roots.find(root => root.startsWith('file://'));
  if (!uri) return undefined;
  const dir = resolve(fileURLToPath(uri));
  if (dir === resolve(cwd)) return undefined;
  const locations = await resolveBrainLocations(dir, env);
  if (locations[0]?.scope !== 'project') locations.unshift({ scope: 'project', root: join(dir, '.edu') });
  await openBrain(locations).init(locations[0]!);
  return locations;
}

/** Some CLIs spawn MCP servers from their plugin folder; the inherited PWD still names the user's shell directory. */
export function launchDirectory(env: NodeJS.ProcessEnv, processCwd = process.cwd()): string {
  const pwd = env.PWD;
  if (pwd && resolve(pwd) !== resolve(processCwd) && existsSync(pwd) && statSync(pwd).isDirectory() && /[\\/]plugins?[\\/]/.test(processCwd)) return pwd;
  return processCwd;
}
