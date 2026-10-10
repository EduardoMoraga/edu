/**
 * Builds orchestrator dependencies from the workspace (brain, config, engines,
 * context provider) and runs one goal. Shared by `edu run` and the TUI home.
 */
import { join } from 'node:path';
import type { CliId, EduEvent, Engine, HarnessLevel, OrchestrationMode } from '../../core/contracts.js';
import type { ApprovalRequest, RunResult } from '../../orchestrator/index.js';
import type { CliContext } from '../context.js';
import { t, type Lang } from '../i18n.js';
import { packageTemplatesDir } from '../package.js';
import { initBrain } from '../setup.js';
import { effectiveConfig, exists, openWorkspace } from '../workspace.js';

export interface RunSetup {
  goal: string;
  cwd: string;
  lang: Lang;
  mode?: OrchestrationMode;
  harnessLevel?: HarnessLevel;
  playbook?: string;
  autoApprove?: boolean;
  cli?: CliId;
  onEvent(event: EduEvent): void | Promise<void>;
  approve(request: ApprovalRequest): Promise<boolean>;
  signal?: AbortSignal;
  /** Engine factory override (tests); defaults to the real CLI adapters. */
  engines?: (cli: CliId) => Engine;
  /** Available CLIs override (tests); defaults to PATH detection. */
  available?: CliId[];
}

export async function executeRun(ctx: CliContext, setup: RunSetup): Promise<RunResult> {
  const available = setup.available ?? ctx.availableClis ?? (await ctx.detectClis());
  if (!available.length) throw new Error(t(setup.lang, 'run.noCli'));
  if (setup.cli && !available.includes(setup.cli)) throw new Error(`${setup.cli} is not installed (found: ${available.join(', ')})`);

  const ws = await openWorkspace(ctx, setup.cwd);
  if (!(await exists(join(ws.primary.root, 'EDU.md')))) {
    await initBrain({ location: ws.primary, templatesDir: packageTemplatesDir(), detected: available, lang: setup.lang });
  }
  const base = await effectiveConfig(ws.primary.root, available);
  const config = { ...base, mode: setup.mode ?? base.mode, defaultCli: setup.cli ?? base.defaultCli, approvals: setup.autoApprove ? 'auto' as const : base.approvals };

  const [{ orchestrate }, { buildContext }, engineModule] = await Promise.all([
    import('../../orchestrator/index.js'),
    import('../../context/index.js'),
    import('../../engine/index.js'),
  ]);
  const eduMdPath = join(ws.primary.root, 'EDU.md');
  return orchestrate(setup.goal, {
    config,
    brain: ws.brain,
    context: { build: (req) => buildContext(ws.brain, req, { eduMdPath }) },
    engines: setup.engines ?? ctx.engineFactory ?? engineModule.createEngine,
    available,
    cwd: setup.cwd,
    onEvent: setup.onEvent,
    approve: setup.approve,
    signal: setup.signal,
    harnessLevel: setup.harnessLevel,
    playbookName: setup.playbook,
    autoApprove: setup.autoApprove,
    runsDir: join(ws.primary.root, 'runs'),
  });
}
