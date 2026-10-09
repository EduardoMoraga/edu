/** `edu mcp`, `edu statusline`, `edu hook session-start|session-end|codex-notify`. */
import type { Command } from 'commander';
import { resolveGlobals, type CliContext } from '../context.js';
import { codexNotify, safeHook, sessionEnd, sessionStart } from '../hooks.js';
import { action } from '../kit.js';
import { statuslineText } from '../statusline.js';

export function registerIntegrations(program: Command, ctx: CliContext): void {
  program
    .command('mcp')
    .description('serve the brain over MCP (stdio) for any MCP-capable CLI')
    .action(
      action(ctx, async ({ g }) => {
        const { runStdioServer } = await import('../../mcp/stdio.js');
        await runStdioServer({ cwd: g.cwd, env: { ...ctx.env, HOME: ctx.env.HOME ?? ctx.home } });
      }),
    );

  program
    .command('statusline')
    .description("one status line for Claude Code (reads its statusline JSON from stdin)")
    .action(async (_opts: unknown, cmd: Command) => {
      // Never break the host statusline: degrade to a bare mark on any error.
      const g = resolveGlobals(ctx, cmd.optsWithGlobals());
      try {
        ctx.out(await statuslineText(ctx, g.cwd, await ctx.readStdin(100)));
      } catch {
        ctx.out('EDU');
      }
    });

  const hook = program.command('hook').description('lifecycle hooks called by coding CLIs (never fail the host)');

  hook
    .command('session-start')
    .description('print the session brief (Claude SessionStart additional context)')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = resolveGlobals(ctx, cmd.optsWithGlobals());
      await safeHook(ctx, 'session-start', () => sessionStart(ctx, g.cwd));
    });

  hook
    .command('session-end')
    .description('record the finished session as a closed episode (Claude SessionEnd JSON on stdin)')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = resolveGlobals(ctx, cmd.optsWithGlobals());
      await safeHook(ctx, 'session-end', () => sessionEnd(ctx, g.cwd));
    });

  hook
    .command('codex-notify')
    .description('record a completed Codex turn (notify JSON as the last argument)')
    .argument('[payload...]', 'notify JSON')
    .action(async (payload: string[] | undefined, _opts: unknown, cmd: Command) => {
      const g = resolveGlobals(ctx, cmd.optsWithGlobals());
      await safeHook(ctx, 'codex-notify', () => codexNotify(ctx, g.cwd, payload?.at(-1)));
    });
}
