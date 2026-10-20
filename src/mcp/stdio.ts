import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openBrain } from '../brain/index.js';
import type { BrainLocation } from '../core/contracts.js';
import { resolveBrainLocations } from './locations.js';
import { selectWorkspace } from './projects.js';
import { createEduMcpServer } from './server.js';
import { getCapabilities } from '../release/capabilities.js';

export interface StdioOptions {
  cwd?: string; env?: NodeJS.ProcessEnv; now?: Date;
  /** Workspace to serve: registry name, agent name, path or "global". Defaults to EDU_PROJECT. */
  project?: string;
  /** Select the declared tool surface without changing stored memory or enabling inference. */
  toolProfile?: 'full' | 'memory';
}

/** Initialize the primary brain and attach the MCP server to stdio. */
export async function runStdioServer(opts: StdioOptions = {}) {
  const server = await createStdioServer(opts);
  await server.connect(new StdioServerTransport());
  return server;
}

/**
 * Builds the server without a transport. With a project (`--project` or EDU_PROJECT) the workspace
 * is pinned and MCP roots are ignored; otherwise the launch directory decides and roots may rebind.
 */
export async function createStdioServer(opts: StdioOptions = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? launchDirectory(env);
  const profile = opts.toolProfile ?? env.EDU_MCP_PROFILE ?? 'full';
  if (profile !== 'full' && profile !== 'memory') throw new Error('Unknown MCP tool profile; use full or memory');
  const capabilities = () => JSON.stringify({ ...getCapabilities(), toolProfile: profile });
  const workspaceLocked = env.EDU_LOCK_WORKSPACE === '1';
  const project = workspaceLocked ? undefined : opts.project?.trim() || env.EDU_PROJECT?.trim() || undefined;
  if (project) {
    const selection = await selectWorkspace(project, env, cwd);
    return createEduMcpServer({
      locations: selection.locations, now: opts.now, env, workspace: selection.root ?? 'global',
      capabilities, toolProfile: profile,
      eduMdPath: join(selection.locations[0]!.root, 'EDU.md'),
    });
  }
  const locations = await resolveBrainLocations(cwd, env);
  const brain = openBrain(locations);
  await brain.init(locations[0]!);
  return createEduMcpServer({
    locations,
    now: opts.now,
    env,
    capabilities, toolProfile: profile,
    workspaceLocked,
    eduMdPath: join(locations[0]!.root, 'EDU.md'),
    resolveLocations: async (mcp) => {
      if (workspaceLocked) return undefined;
      if (!mcp.server.getClientCapabilities()?.roots) return undefined;
      return resolveReboundLocations(cwd, env, async () => (await mcp.server.listRoots()).roots.map(root => root.uri));
    },
  });
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
