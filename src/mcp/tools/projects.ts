/** Workspace tools: list the registered workspaces and switch this session to another one. */
import { z } from 'zod';
import { listWorkspaces, selectWorkspace } from '../projects.js';
import type { ToolContext } from './context.js';
import { tokenLimit } from './schema.js';

export function registerProjectTools(ctx: ToolContext): void {
  const { register, env } = ctx;

  register('edu_projects', 'List workspaces and agent names; marks the active one', { maxTokens: tokenLimit },
    async () => {
      const workspaces = await listWorkspaces(env);
      const workspace = ctx.workspace;
      const rows = workspaces.map(w => `${w.root === workspace || w.name === workspace ? '* ' : '  '}${w.name} · agent ${w.agent} · ${w.root}${w.present ? '' : ' (missing)'}`);
      return [`Active: ${workspace}`, ...(rows.length ? rows : ['No registered workspaces. Create one with `edu create`.']),
        'Switch with edu_project_use (workspace name, agent name, path, or "global").'].join('\n');
    });

  register('edu_project_use', 'Switch this session\'s workspace: workspace name, agent name, path or "global"', {
    workspace: z.string().min(1), maxTokens: tokenLimit,
  }, async ({ workspace: selector }) => {
    if (ctx.opts.workspaceLocked) throw new Error('The host owns this workspace. Change the host working directory and restart its Edu MCP server before switching brains.');
    // Registered workspaces or folders that already hold a brain; MCP never creates one.
    const selection = await selectWorkspace(selector, env, process.cwd(), { create: false });
    ctx.switchTo(selection.locations, selection.root ?? 'global');
    const agent = selection.root ? (await listWorkspaces(env)).find(w => w.root === selection.root)?.agent : undefined;
    return `Active workspace: ${selection.label}${agent ? ` (agent ${agent})` : ''} · brain ${selection.locations[0]!.root}`;
  });
}
