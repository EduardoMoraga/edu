/**
 * `edu watch [jobId]` — mission control for crew jobs (ARCHITECTURE §16.4).
 * In a terminal it opens the live view over `<brainRoot>/crew/*.json` and
 * tails each job's `.jsonl` events (one agent per job). Piped, it lists the
 * jobs, or prints one job's events, and exits.
 */
import type { Command } from 'commander';
import { fsCrewSource } from '../../tui/crew.js';
import { createCrew } from '../../crew/index.js';
import type { CliContext } from '../context.js';
import { uiLang } from '../i18n.js';
import { action, parseIntOption } from '../kit.js';
import { identityName, openWorkspace } from '../workspace.js';

interface WatchOpts {
  poll?: string;
}

export function registerWatch(program: Command, ctx: CliContext): void {
  program
    .command('watch')
    .description('watch crew jobs live: one agent per job, wrapped output, / commands')
    .argument('[jobId]', 'only this job (full id or unique prefix)')
    .option('--poll <ms>', 'how often to check for new jobs and events', '500')
    .action(
      action<WatchOpts>(ctx, async ({ g, opts, cmd }, jobId) => {
        const pollMs = parseIntOption(opts.poll ?? '500', '--poll');
        const ws = await openWorkspace(ctx, g.cwd);
        const crew = createCrew({ brainRoot: ws.primary.root, locations: ws.locations });
        const source = fsCrewSource(ws.primary.root, jobId => crew.status(jobId));
        const id = jobId?.trim() || undefined;
        const { watchInTui, watchPlain } = await import('../run/watch.js');
        if (!ctx.isTTY) return watchPlain(ctx, { source, jobId: id, lang: g.lang });
        const { cliDispatch, selfRunner } = await import('../run/commands.js');
        const explicitLang = (cmd.optsWithGlobals() as { lang?: string }).lang !== undefined;
        await watchInTui({
          source,
          jobId: id,
          lang: g.lang,
          uiLang: uiLang(g.lang, ctx.env, explicitLang),
          name: await identityName(ws.primary.root),
          pollMs,
          brain: ws.brain,
          dispatch: cliDispatch(selfRunner(), g.cwd),
        });
      }),
    );
}
