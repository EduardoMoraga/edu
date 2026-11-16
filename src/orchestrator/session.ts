/**
 * The run use case: opens the workspace brain for `cwd` (creating it on first use), loads its config and runs one
 * goal through the orchestrator. `edu run`, the TUI home and detached crew orchestrations all start here; the CLI
 * and the crew worker are adapters that supply the host (installed CLIs and environment).
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { openBrain } from '../brain/index.js';
import type { CliId, EduConfig, EduEvent, Engine, HarnessLevel, OrchestrationMode } from '../core/contracts.js';
import { resolveBrainLocations } from '../mcp/locations.js';
import { initBrain } from '../workspace/init.js';
import type { ApprovalAnswer, ApprovalRequest, RunResult } from './run.js';

export const NO_CLI_MESSAGE = 'No supported coding CLI found on PATH. Install one, or try: edu demo';

/** What the caller's host provides. */
export interface RunHost {
  /** Installed coding CLIs, in preference order. */
  available: CliId[];
  /** The environment the brains are located from (EDU_HOME, HOME, EDU_CEILING_DIRECTORIES). */
  env: NodeJS.ProcessEnv;
  /** Home directory used when `env` has no HOME. */
  home: string;
}

export interface RunRequest {
  goal: string;
  cwd: string;
  lang: EduConfig['lang'];
  mode?: OrchestrationMode;
  harnessLevel?: HarnessLevel;
  playbook?: string;
  autoApprove?: boolean;
  /** `--allow-unregistered-checks`: planner-proposed checks run without a person approving them. */
  allowUnregisteredChecks?: boolean;
  cli?: CliId;
  onEvent(event: EduEvent): void | Promise<void>;
  approve(request: ApprovalRequest): Promise<boolean | ApprovalAnswer>;
  signal?: AbortSignal;
  /** Engine factory override (tests); defaults to the real CLI adapters. */
  engines?: (cli: CliId) => Engine;
}

export async function runSession(host: RunHost, request: RunRequest): Promise<RunResult> {
  const { available } = host;
  if (!available.length) throw new Error(NO_CLI_MESSAGE);
  if (request.cli && !available.includes(request.cli)) throw new Error(`${request.cli} is not installed (found: ${available.join(', ')})`);

  const locations = await resolveBrainLocations(request.cwd, { ...host.env, HOME: host.env.HOME ?? host.home });
  const primary = locations[0]!;
  const brain = openBrain(locations);
  const eduMdPath = join(primary.root, 'EDU.md');
  // Lazy: keeps zod, the adapters and the engines out of the paths that never run a goal.
  if (!(await exists(eduMdPath))) {
    const { resolveTemplatesDir } = await import('../adapters/index.js');
    await initBrain({ location: primary, templatesDir: resolveTemplatesDir(), detected: available, lang: request.lang });
  }
  const [{ defaultConfig, loadConfig, loadCrewPolicy }, { orchestrate }, { buildContext }, { createEngine }] = await Promise.all([
    import('./config.js'),
    import('./run.js'),
    import('../context/index.js'),
    import('../engine/index.js'),
  ]);
  const configPath = join(primary.root, 'config.json');
  const base = await exists(configPath) ? await loadConfig(configPath) : defaultConfig(available[0] ?? 'claude');
  const config = { ...base, mode: request.mode ?? base.mode, defaultCli: request.cli ?? base.defaultCli, approvals: request.autoApprove ? 'auto' as const : base.approvals };
  // A project's config and playbooks live where agents and cloned repositories can write, so the person's global
  // crew.maxAutonomy bounds their roles. The global brain's own config is the person's choice.
  const global = locations.find(location => location.scope === 'global')!;
  const maxAutonomy = primary.scope === 'project' ? (await loadCrewPolicy(global.root)).maxAutonomy : undefined;

  return orchestrate(request.goal, {
    config,
    brain,
    context: { build: (req) => buildContext(brain, req, { eduMdPath }) },
    engines: request.engines ?? createEngine,
    available,
    cwd: request.cwd,
    onEvent: request.onEvent,
    approve: request.approve,
    signal: request.signal,
    harnessLevel: request.harnessLevel,
    playbookName: request.playbook,
    autoApprove: request.autoApprove,
    allowUnregisteredChecks: request.allowUnregisteredChecks,
    ...(maxAutonomy ? { maxAutonomy } : {}),
    runsDir: join(primary.root, 'runs'),
  });
}

const exists = (path: string) => access(path).then(() => true, () => false);
