/**
 * CLI adapter for the run use case (`orchestrator/session.ts`), shared by `edu run` and the TUI home: it supplies
 * the installed CLIs and the environment from the CLI context and reports a missing CLI in the user's language.
 */
import type { CliId } from '../../core/contracts.js';
import type { RunResult } from '../../orchestrator/index.js';
import type { RunRequest } from '../../orchestrator/session.js';
import type { CliContext } from '../context.js';
import { t, type Lang } from '../i18n.js';

export interface RunSetup extends RunRequest {
  lang: Lang;
  /** Available CLIs override (tests); defaults to PATH detection. */
  available?: CliId[];
}

export async function executeRun(ctx: CliContext, setup: RunSetup): Promise<RunResult> {
  const available = setup.available ?? ctx.availableClis ?? (await ctx.detectClis());
  if (!available.length) throw new Error(t(setup.lang, 'run.noCli'));
  const { runSession } = await import('../../orchestrator/session.js');
  return runSession({ available, env: ctx.env, home: ctx.home }, { ...setup, engines: setup.engines ?? ctx.engineFactory });
}
