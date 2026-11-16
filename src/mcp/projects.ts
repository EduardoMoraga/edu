/**
 * Workspace selection for the MCP server: list the registered workspaces (with each one's agent
 * identity name) and resolve a selector — a registry name, an agent name such as "albert", a path,
 * or "global" — to brain locations. Used by `edu mcp --project` / EDU_PROJECT and the
 * `edu_projects` / `edu_project_use` tools, so a host outside any project (e.g. Hermes on
 * Telegram) can pick the workspace it talks to.
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { openBrain } from '../brain/index.js';
import { readWorkspaceSettings, withBrainDir } from '../brain/location.js';
import type { BrainLocation } from '../core/contracts.js';
import { readProjects } from '../brain/registry.js';
import { resolveBrainLocations } from '../brain/locations.js';

export interface WorkspaceInfo { name: string; agent: string; root: string; present: boolean }

export function eduHomeOf(env: NodeJS.ProcessEnv): string {
  return resolve(env.EDU_HOME || join(env.HOME || homedir(), '.edu'));
}

/** Registered workspaces with their agent identity names (`identity.name`, else "Edu"). */
export async function listWorkspaces(env: NodeJS.ProcessEnv): Promise<WorkspaceInfo[]> {
  const { projects } = await readProjects(eduHomeOf(env));
  return Promise.all(projects.map(async (entry) => {
    const present = existsSync(join(entry.root, '.edu'));
    const agent = present ? (await readWorkspaceSettings(join(entry.root, '.edu'))).identity?.name ?? 'Edu' : 'Edu';
    return { name: entry.name, agent, root: entry.root, present };
  }));
}

const GLOBAL = new Set(['global', '~', 'edu-home']);
const looksLikePath = (selector: string) => isAbsolute(selector) || selector.startsWith('.') || selector.startsWith('~/') || /[\\/]/.test(selector);

export interface Selection { label: string; root: string | undefined; locations: BrainLocation[] }
export interface SelectOptions {
  /**
   * Create the project brain when the folder has none. Only for workspaces a person named at launch
   * (`edu mcp --project`, EDU_PROJECT, `edu connect --project`); MCP tools never create a brain.
   */
  create?: boolean;
}

/**
 * Resolves a selector to brain locations (project first, global last). Registry names and agent names
 * match case-insensitively; an ambiguous agent name fails. Without `create`, a path must already hold an
 * `.edu/` brain and nothing is written; with it, a folder without one gets a new project brain.
 */
export async function selectWorkspace(selector: string, env: NodeJS.ProcessEnv, cwd = process.cwd(), options: SelectOptions = {}): Promise<Selection> {
  const wanted = selector.trim();
  if (!wanted) throw new Error('Workspace selector must not be empty');
  const home = eduHomeOf(env);
  if (GLOBAL.has(wanted.toLowerCase())) {
    return { label: 'global', root: undefined, locations: [await withBrainDir({ scope: 'global', root: home })] };
  }
  let root: string | undefined;
  let label = wanted;
  if (looksLikePath(wanted)) {
    const path = wanted.startsWith('~/') ? join(env.HOME || homedir(), wanted.slice(2)) : resolve(cwd, wanted);
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Workspace folder not found: ${path}`);
    if (!options.create && !isDirectory(join(path, '.edu'))) throw new Error(`Not an Edu workspace: ${path}. Pick a registered workspace (edu_projects) or a folder that already has a .edu brain; create one with \`edu init\` there.`);
    root = path;
  } else {
    const workspaces = await listWorkspaces(env);
    const lower = wanted.toLowerCase();
    const byName = workspaces.find(w => w.name.toLowerCase() === lower);
    const byAgent = workspaces.filter(w => w.agent.toLowerCase() === lower);
    const match = byName ?? (byAgent.length === 1 ? byAgent[0] : undefined);
    if (!match) {
      const known = workspaces.map(w => `${w.name} (${w.agent})`).join(', ') || 'none registered';
      const why = byAgent.length > 1 ? `"${wanted}" is the agent of several workspaces; use the workspace name` : `Unknown workspace "${wanted}"`;
      throw new Error(`${why}. Registered: ${known}`);
    }
    if (!match.present) throw new Error(`Workspace ${match.name} is registered but missing: ${match.root}`);
    root = match.root;
    label = match.name;
  }
  const locations = await resolveBrainLocations(root, env);
  if (!options.create) return { label, root: dirname(locations[0]!.root), locations };
  // A folder inside a workspace uses that workspace; a folder outside any gets its own brain.
  if (locations[0]?.scope !== 'project' && !locations.some(location => location.root === join(root, '.edu'))) locations.unshift({ scope: 'project', root: join(root, '.edu') });
  await openBrain(locations).init(locations[0]!);
  return { label, root: dirname(locations[0]!.root), locations };
}

const isDirectory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
