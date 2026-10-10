/** `edu` (home), `edu run`, `edu ui`, `edu demo`. */
import type { Command } from 'commander';
import type { EduEvent, HarnessLevel, OrchestrationMode } from '../../core/contracts.js';
import { atomicWrite } from '../../brain/store.js';
import { resolve } from 'node:path';
import { getGlyphs, renderBanner } from '../../identity/index.js';
import type { CliContext, Resolved } from '../context.js';
import { t, uiLang } from '../i18n.js';
import { action, look, parsePositive } from '../kit.js';
import { packageVersion } from '../package.js';
import { createPlainFormatter } from '../run/plain.js';
import { identityName, lessonCount, openWorkspace } from '../workspace.js';
import { parseCli } from './setup.js';

interface RunOpts { solo?: boolean; crew?: boolean; cli?: string; yes?: boolean; harness?: string; playbook?: string; detach?: boolean }
interface UiOpts { replay?: string; speed?: string }
interface DemoOpts { speed?: string; save?: string }

/** Prints events as plain lines (non-TTY output). */
export function printPlain(ctx: CliContext, events: Iterable<EduEvent>): void {
  const format = createPlainFormatter(getGlyphs(ctx.env));
  for (const event of events) {
    const line = format(event);
    if (line) ctx.out(line);
  }
}

/** TUI home: banner, brain stats, detected CLIs, then the live view with a composer. */
export async function openHome(ctx: CliContext, g: Resolved): Promise<void> {
  const { shouldRunFirstSetup, runPluginSetup } = await import('./plugins.js');
  if (await shouldRunFirstSetup(ctx)) {
    await runPluginSetup(ctx, g);
    return;
  }
  const style = look(ctx);
  const ws = await openWorkspace(ctx, g.cwd);
  const [stats, name, clis] = await Promise.all([ws.brain.stats(), identityName(ws.primary.root), ctx.detectClis()]);
  ctx.out(renderBanner({ unicode: style.glyphs.unicode, theme: style.theme, name, version: packageVersion() }));
  ctx.out('');
  ctx.out(t(g.lang, 'home.brain', { total: stats.total, lessons: lessonCount(stats.byStatus) }));
  ctx.out(clis.length ? t(g.lang, 'home.clis', { clis: clis.join(', ') }) : t(g.lang, 'home.noClis'));
  ctx.out(t(g.lang, 'home.hint'));
  const { runHome } = await import('../run/live.js');
  await runHome(ctx, { cwd: g.cwd, lang: g.lang, name });
}

function modeFrom(opts: RunOpts): OrchestrationMode | undefined {
  if (opts.solo && opts.crew) throw new Error('choose one of --solo or --crew');
  return opts.solo ? 'solo' : opts.crew ? 'crew' : undefined;
}

function harnessFrom(value: string | undefined): HarnessLevel | undefined {
  if (value === undefined) return undefined;
  const harness = value;
  if (!['H0', 'H1', 'H2', 'H3'].includes(harness)) throw new Error('--harness must be H0, H1, H2, or H3');
  return harness as HarnessLevel;
}

export function registerLive(program: Command, ctx: CliContext): void {
  program
    .command('run')
    .description('run a goal: plan, approve, execute, review, learn')
    .argument('<goal...>', 'what you want done')
    .option('--solo', 'one CLI plays every role')
    .option('--crew', 'roles mapped to different CLIs')
    .option('--cli <cli>', 'CLI to use as the default engine')
    .option('--harness <level>', 'evidence support level: H0 | H1 | H2 | H3')
    .option('--playbook <name>', 'method to use for this run')
    .option('--detach', 'run as a watchable crew job')
    .option('-y, --yes', 'approve every step automatically')
    .action(
      action<RunOpts>(ctx, async ({ g, opts }, goal) => {
        const mode = modeFrom(opts);
        const harnessLevel = harnessFrom(opts.harness);
        const cli = opts.cli ? parseCli(opts.cli) : undefined;
        const text = (goal ?? '').trim();
        if (!text) throw new Error('a goal is required');
        if (opts.detach) {
          const { createCrew } = await import('../../crew/index.js');
          const ws = await openWorkspace(ctx, g.cwd);
          const job = await createCrew({ brainRoot: ws.primary.root, locations: ws.locations, workspaceRoot: g.cwd, engineFactory: ctx.engineFactory, detectClis: ctx.detectClis }).orchestrate({
            goal: text, cwd: g.cwd, mode, cli, harnessLevel, playbook: opts.playbook, autoApprove: Boolean(opts.yes),
          });
          ctx.out(JSON.stringify(job));
          return;
        }
        if (ctx.isTTY) {
          const ws = await openWorkspace(ctx, g.cwd);
          const { runInTui } = await import('../run/live.js');
          const result = await runInTui(ctx, { goal: text, cwd: g.cwd, lang: g.lang, mode, harnessLevel, cli, playbook: opts.playbook, autoApprove: Boolean(opts.yes), name: await identityName(ws.primary.root) });
          if (result) ctx.out(t(g.lang, 'run.done', { status: t(g.lang, result.ok ? 'run.ok' : 'run.failed'), summary: result.summary }));
          if (!result?.ok) ctx.setExitCode(1);
          return;
        }
        await runPlain(ctx, g, text, mode, cli, harnessLevel, opts.playbook, Boolean(opts.yes));
      }),
    );

  program
    .command('ui')
    .description('open the live view, or replay a recorded run')
    .option('--replay <file>', 'runs/<id>.jsonl to replay')
    .option('--speed <n>', 'replay speed multiplier', '1')
    .action(
      action<UiOpts>(ctx, async ({ g, opts }) => {
        if (!opts.replay) {
          if (ctx.isTTY) await openHome(ctx, g);
          else ctx.out(program.helpInformation());
          return;
        }
        const speed = parsePositive(opts.speed ?? '1', '--speed');
        const { loadRun, timedEvents } = await import('../../tui/replay.js');
        const run = await loadRun(opts.replay);
        for (const issue of run.issues) ctx.err(`${opts.replay}:${issue.line}: ${issue.message} (skipped)`);
        if (!ctx.isTTY) return printPlain(ctx, run.events);
        const { playInTui } = await import('../run/live.js');
        await playInTui(timedEvents(run.events, { speed, maxDelayMs: 2000 }), 'Edu', uiLang(g.lang, ctx.env));
      }),
    );

  program
    .command('demo')
    .description('watch a scripted crew in the live view (no LLM needed)')
    .option('--speed <n>', 'playback speed multiplier', '1')
    .option('--save <file>', 'save the demo event stream as JSONL for replay')
    .action(
      action<DemoOpts>(ctx, async ({ g, opts }) => {
        const speed = parsePositive(opts.speed ?? '1', '--speed');
        const { demoScript } = await import('../../engine/fake.js');
        const events = demoScript();
        if (opts.save) await atomicWrite(resolve(g.cwd, opts.save), `${events.map(event => JSON.stringify(event)).join('\n')}\n`);
        if (!ctx.isTTY) {
          ctx.out(t(g.lang, 'demo.plain'));
          return printPlain(ctx, events);
        }
        const [{ timedEvents }, { playInTui }] = await Promise.all([import('../../tui/replay.js'), import('../run/live.js')]);
        await playInTui(timedEvents(events, { speed }), 'Edu', uiLang(g.lang, ctx.env));
      }),
    );
}

async function runPlain(
  ctx: CliContext,
  g: Resolved,
  goal: string,
  mode: OrchestrationMode | undefined,
  cli: ReturnType<typeof parseCli> | undefined,
  harnessLevel: HarnessLevel | undefined,
  playbook: string | undefined,
  yes: boolean,
): Promise<void> {
  const available = ctx.availableClis ?? await ctx.detectClis();
  if (!available.length) throw new Error(t(g.lang, 'run.noCli'));
  if (!yes && !ctx.stdinIsTTY) throw new Error('Plain runs require --yes when stdin is not a TTY');
  const { executeRun } = await import('../run/session.js');
  const format = createPlainFormatter(getGlyphs(ctx.env));
  const abort = new AbortController();
  const onSigint = () => {
    ctx.err(t(g.lang, 'run.cancelling'));
    abort.abort();
  };
  process.once('SIGINT', onSigint);
  try {
    const result = await executeRun(ctx, {
      goal,
      cwd: g.cwd,
      lang: g.lang,
      mode,
      cli,
      harnessLevel,
      playbook,
      autoApprove: yes,
      engines: ctx.engineFactory,
      available,
      signal: abort.signal,
      onEvent: (event) => {
        const line = format(event);
        if (line) ctx.out(line);
      },
      approve: async request => yes || ctx.confirm(request.title),
    });
    if (!result.ok) ctx.setExitCode(1);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}
