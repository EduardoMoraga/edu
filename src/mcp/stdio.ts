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
    // A person named this workspace at launch, so it may be created here; MCP tools never create one.
    const selection = await selectWorkspace(project, env, cwd, { create: true });
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

/** The client has not reported a workspace root yet; the server asks again on the next tool call. */
export class RootsNotReady extends Error {
  constructor() { super('MCP client roots are not available yet'); }
}

/**
 * The brain for the client's workspace root (MCP roots). Roots come from the client, so they follow the
 * same rule as edu_project_use: the brain that already holds that folder (its own `.edu/` or an enclosing
 * workspace's), else the global brain. Nothing is created. Throws RootsNotReady while there is no file root.
 */
export async function resolveReboundLocations(
  cwd: string, env: NodeJS.ProcessEnv, listRoots: () => Promise<string[]>,
): Promise<BrainLocation[] | undefined> {
  let roots: string[];
  try { roots = await listRoots(); }
  catch { roots = await listRoots(); }
  const uri = roots.find(root => root.startsWith('file://'));
  if (!uri) throw new RootsNotReady();
  const dir = resolve(fileURLToPath(uri));
  if (dir === resolve(cwd)) return undefined;
  return resolveBrainLocations(dir, env);
}

/** Some CLIs spawn MCP servers from their plugin folder; the inherited PWD still names the user's shell directory. */
export function launchDirectory(env: NodeJS.ProcessEnv, processCwd = process.cwd()): string {
  const pwd = env.PWD;
  if (pwd && resolve(pwd) !== resolve(processCwd) && existsSync(pwd) && statSync(pwd).isDirectory() && /[\\/]plugins?[\\/]/.test(processCwd)) return pwd;
  return processCwd;
}
