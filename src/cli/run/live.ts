/**
 * Terminal drivers: mount the Ink live view for a run, the home screen
 * (composer starts a solo run), demos and replays. Non-TTY callers use the
 * plain formatter instead. Ink/React are imported lazily.
 */
import type { CliId, EduEvent, HarnessLevel, OrchestrationMode } from '../../core/contracts.js';
import type { RunResult } from '../../orchestrator/index.js';
import type { CliContext } from '../context.js';
import { uiLang, type Lang } from '../i18n.js';
import { openWorkspace } from '../workspace.js';
import { ApprovalBridge } from './bridge.js';
import { createChannel } from './channel.js';
import { createCommandHandler } from './commands.js';
import { executeRun } from './session.js';

export interface LiveRunOptions {
  goal: string;
  cwd: string;
  lang: Lang;
  mode?: OrchestrationMode;
  harnessLevel?: HarnessLevel;
  cli?: CliId;
  autoApprove: boolean;
  name: string;
}

/** Runs one goal under the live TUI; resolves after the user leaves the view. */
export async function runInTui(ctx: CliContext, opts: LiveRunOptions): Promise<RunResult | undefined> {
  const { renderTui } = await import('../../tui/index.js');
  const channel = createChannel<EduEvent>();
  const bridge = new ApprovalBridge();
  const abort = new AbortController();
  const app = renderTui({
    events: channel,
    name: opts.name,
    lang: uiLang(opts.lang, ctx.env),
    onApprove: bridge.answer,
    onCommand: createCommandHandler({ lang: opts.lang, brain: (await openWorkspace(ctx, opts.cwd)).brain }),
    onCancel: () => {
      abort.abort();
      bridge.rejectAll();
    },
  });
  const exited = app.waitUntilExit().then(() => {
    abort.abort();
    bridge.rejectAll();
  });
  let result: RunResult | undefined;
  try {
    result = await executeRun(ctx, {
      ...opts,
      signal: abort.signal,
      engines: ctx.engineFactory,
      available: ctx.availableClis,
      onEvent: (event) => {
        bridge.observe(event);
        channel.push(event);
      },
      approve: opts.autoApprove ? async () => true : bridge.approve,
    });
  } catch (error) {
    channel.push({ type: 'error', message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
  }
  await exited;
  channel.close();
  return result;
}

export interface HomeOptions {
  cwd: string;
  lang: Lang;
  name: string;
}

/** Home screen: the composer starts a solo run with the default CLI; one run at a time. */
export async function runHome(ctx: CliContext, opts: HomeOptions): Promise<void> {
  const { renderTui } = await import('../../tui/index.js');
  const channel = createChannel<EduEvent>();
  const bridge = new ApprovalBridge();
  let abort: AbortController | undefined;
  const startRun = (goal: string) => {
    if (abort) return;
    const current = new AbortController();
    abort = current;
    void executeRun(ctx, {
      goal,
      cwd: opts.cwd,
      lang: opts.lang,
      mode: 'solo',
      signal: current.signal,
      onEvent: (event) => {
        bridge.observe(event);
        channel.push(event);
      },
      approve: bridge.approve,
    })
      .catch((error: unknown) => {
        channel.push({ type: 'error', message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
      })
      .finally(() => {
        abort = undefined;
      });
  };
  const app = renderTui({
    events: channel,
    name: opts.name,
    lang: uiLang(opts.lang, ctx.env),
    onSubmit: startRun,
    onCommand: createCommandHandler({ lang: opts.lang, brain: (await openWorkspace(ctx, opts.cwd)).brain }),
    onApprove: bridge.answer,
    onCancel: () => {
      abort?.abort();
      bridge.rejectAll();
    },
  });
  await app.waitUntilExit();
  abort?.abort();
  bridge.rejectAll();
  channel.close();
}

/** Plays a finished or scripted event list through the live view. */
export async function playInTui(events: AsyncIterable<EduEvent>, name: string, lang: Lang = 'en'): Promise<void> {
  const { renderTui } = await import('../../tui/index.js');
  const app = renderTui({ events, name, lang });
  await app.waitUntilExit();
}
