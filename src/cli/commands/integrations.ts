/** `edu brief`, `edu mcp`, `edu statusline`, `edu hook session-start|session-end|codex-notify`. */
import type { Command } from 'commander';
import { resolveGlobals, type CliContext } from '../context.js';
import { codexNotify, safeHook, sessionEnd, sessionStart, workspaceBrief } from '../hooks.js';
import { t } from '../i18n.js';
import { action, printJson } from '../kit.js';
import { statuslineText } from '../statusline.js';

export function registerIntegrations(program: Command, ctx: CliContext): void {
  program
    .command('brief')
    .description('print the session brief (same as the session-start hook and the edu_brief MCP tool); with a query, add the notes that match it')
    .argument('[query...]', 'optional goal to recall notes for')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts, cmd }) => {
        const query = (cmd.args as string[]).join(' ').trim();
        const result = await workspaceBrief(ctx, g.cwd);
        if (!result) throw new Error(t(g.lang, 'brief.noBrain'));
        const hits = query ? await result.ws.brain.recall(query, { limit: 5 }) : [];
        if (g.json || opts.json) {
          return printJson(ctx, { text: result.text, ...(query ? { query, hits: hits.map((h) => ({ id: h.note.meta.id, title: h.note.meta.title, band: h.note.meta.band, status: h.note.meta.status, why: h.why })) } : {}) });
        }
        ctx.out(result.text);
        if (!query) return;
        ctx.out('');
        ctx.out(t(g.lang, 'brief.relevant', { query }));
        if (!hits.length) ctx.out(`- ${t(g.lang, 'brain.empty')}`);
        for (const h of hits) ctx.out(`- [[${h.note.meta.id}]] ${h.note.meta.title}${h.note.meta.band ? ` (${h.note.meta.band})` : ''}`);
      }),
    );

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
