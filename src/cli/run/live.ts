/**
 * Terminal drivers: mount the Ink live view for a run, the home screen
 * (composer handles chat or tasks), demos and replays. Non-TTY callers use the
 * plain formatter instead. Ink/React are imported lazily.
 */
import type { CliId, EduEvent, HarnessLevel, OrchestrationMode } from '../../core/contracts.js';
import type { ChatHistory } from '../../chat/respond.js';
import { join } from 'node:path';
import type { RunResult } from '../../orchestrator/index.js';
import type { CliContext } from '../context.js';
import { uiLang, type Lang } from '../i18n.js';
import { packageTemplatesDir } from '../package.js';
import { initBrain } from '../setup.js';
import { effectiveConfig, exists, openWorkspace } from '../workspace.js';
import { ApprovalBridge } from './bridge.js';
import { createChannel } from './channel.js';
import { createCommandHandler } from './commands.js';
import { createHomeSession } from './home.js';
import { executeRun } from './session.js';

export interface LiveRunOptions {
  goal: string;
  cwd: string;
  lang: Lang;
  mode?: OrchestrationMode;
  harnessLevel?: HarnessLevel;
  playbook?: string;
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
      autoApprove: opts.autoApprove,
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

/** Home screen: chat first, then existing orchestration only for explicit tasks. */
export async function runHome(ctx: CliContext, opts: HomeOptions): Promise<void> {
  const { renderTui } = await import('../../tui/index.js');
  const { respond } = await import('../../chat/respond.js');
  const { createEngine } = await import('../../engine/index.js');
  const channel = createChannel<EduEvent>();
  const bridge = new ApprovalBridge();
  const ws = await openWorkspace(ctx, opts.cwd);
  const available = ctx.availableClis ?? await ctx.detectClis();
  if (!(await exists(join(ws.primary.root, 'EDU.md')))) {
    await initBrain({ location: ws.primary, templatesDir: packageTemplatesDir(), detected: available, lang: opts.lang });
  }
  const config = await effectiveConfig(ws.primary.root, available);
  const history: ChatHistory = { turns: [] };
  let abort: AbortController | undefined;
  let closed = false;
  const runTurn = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (closed) throw new Error('Home view is closed');
    const current = new AbortController();
    abort = current;
    try {
      return await work(current.signal);
    } finally {
      abort = undefined;
    }
  };
  const emit = (event: EduEvent) => { bridge.observe(event); channel.push(event); };
  const home = createHomeSession({
    lang: opts.lang,
    emit,
    say: text => emit({ type: 'agent.text', agentId: 'edu', text, at: new Date().toISOString() }),
    respond: ({ message, forceChat }) => runTurn(signal => respond({ message, forceChat, history, config, brain: ws.brain,
      engines: ctx.engineFactory ?? createEngine, cwd: opts.cwd, contractPath: join(ws.primary.root, 'EDU.md'), onEvent: emit, signal })),
    runTask: goal => runTurn(async signal => {
      await executeRun(ctx, { goal, cwd: opts.cwd, lang: opts.lang, mode: 'solo', signal,
        onEvent: emit, approve: bridge.approve, engines: ctx.engineFactory, available });
    }),
  });
  const submit = (message: string) => {
    void home.submit(message).catch((error: unknown) => {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
    });
  };
  const app = renderTui({
    events: channel,
    name: opts.name,
    lang: uiLang(opts.lang, ctx.env),
    onSubmit: submit,
    onCommand: createCommandHandler({ lang: opts.lang, brain: ws.brain }),
    onApprove: bridge.answer,
    onCancel: () => {
      abort?.abort();
      bridge.rejectAll();
    },
  });
  await app.waitUntilExit();
  closed = true;
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
