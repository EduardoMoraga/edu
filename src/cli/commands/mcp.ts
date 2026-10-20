/**
 * `edu mcp --project <name|path>`: serve one workspace's brain over stdio MCP.
 *
 * The `mcp` command itself is declared with the other integrations; this module adds the workspace
 * selector and takes over its action, so hosts outside any project (Hermes on Telegram, launchd
 * services) can pin a workspace. EDU_PROJECT does the same for hosts that only pass environment.
 */
import type { Command } from 'commander';
import type { CliContext } from '../context.js';
import { action } from '../kit.js';

export function registerMcpProject(program: Command, ctx: CliContext): void {
  const mcp = program.commands.find((c) => c.name() === 'mcp');
  if (!mcp) throw new Error('The mcp command must be registered before its --project option');
  mcp
    .option('--project <name|path>', 'serve this workspace: registry name, agent name, path, or "global" (env EDU_PROJECT)')
    .option('--profile <full|memory>', 'tool surface: full (default) or memory only (env EDU_MCP_PROFILE)')
    .action(
      action<{ project?: string; profile?: string }>(ctx, async ({ g, opts }) => {
        if (opts.profile && opts.profile !== 'full' && opts.profile !== 'memory') throw new Error('Unknown MCP tool profile; use full or memory');
        const { runStdioServer } = await import('../../mcp/stdio.js');
        await runStdioServer({ cwd: g.cwd, project: opts.project, toolProfile: opts.profile as 'full' | 'memory' | undefined, env: { ...ctx.env, HOME: ctx.env.HOME ?? ctx.home } });
      }),
    );
}
