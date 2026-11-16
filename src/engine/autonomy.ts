import type { Autonomy, CliId, EngineCapabilities } from '../core/contracts.js';

/**
 * The sole source of CLI autonomy flags. The levels mean the same thing on every CLI that can express them:
 *
 * - `readonly`: read and search only; no file writes and no tool that could write.
 * - `ask`: writes need a person's approval. A headless run has nobody to ask, so its writes are refused.
 * - `auto`: edit the workspace and run commands without asking.
 * - `full`: no permission checks at all.
 *
 * Headless mapping per CLI:
 *
 * | CLI      | readonly                     | ask                       | auto                                       | full                              |
 * |----------|------------------------------|---------------------------|--------------------------------------------|-----------------------------------|
 * | claude   | `--permission-mode plan`     | `--permission-mode default` (with `-p`, anything that needs permission is denied) | `acceptEdits` + `--allowedTools Bash`: edits and ANY shell command, no OS sandbox | `bypassPermissions` |
 * | codex    | `-s read-only`               | `-s read-only` (`codex exec` never asks, so it cannot write) | `-s workspace-write`: OS sandbox, writes only in the workspace, no network by default | `-s danger-full-access` |
 * | pi       | `--tools read,grep,find,ls`  | same as readonly (Pi never asks) | none: Pi's default tools (read, bash, edit, write) | none                     |
 * | opencode | none                         | none                      | none                                       | none                              |
 * | agy      | none                         | none                      | none                                       | `--dangerously-skip-permissions`  |
 *
 * "none" means the CLI's own configuration decides. OpenCode and agy cannot enforce `readonly` from Edu;
 * callers that need it pick another CLI or refuse (see `engineCapabilities`). Claude `auto` is the one
 * level that differs in strength from Codex `auto`: Claude has the shell without Codex's OS sandbox.
 */
export const AUTONOMY_FLAGS: Record<CliId, Record<Autonomy, readonly string[]>> = {
  claude: {
    readonly: ['--permission-mode', 'plan'],
    ask: ['--permission-mode', 'default'],
    // acceptEdits alone blocks shell tests; explicitly allow Bash for builder verification.
    auto: ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash'],
    full: ['--permission-mode', 'bypassPermissions'],
  },
  codex: {
    readonly: ['-s', 'read-only'],
    ask: ['-s', 'read-only'],
    auto: ['-s', 'workspace-write'],
    full: ['-s', 'danger-full-access'],
  },
  pi: {
    readonly: ['--tools', 'read,grep,find,ls'],
    ask: ['--tools', 'read,grep,find,ls'],
    auto: [],
    full: [],
  },
  opencode: { readonly: [], ask: [], auto: [], full: [] },
  agy: { readonly: [], ask: [], auto: [], full: ['--dangerously-skip-permissions'] },
};

/**
 * Interactive sessions (crew pane mode) have a person at the pane, so `ask` can really ask. Only Codex
 * takes different flags interactively: its approval policy (`-a`) exists outside `codex exec`.
 */
const INTERACTIVE_OVERRIDES: Partial<Record<CliId, Partial<Record<Autonomy, readonly string[]>>>> = {
  codex: {
    readonly: ['-s', 'read-only', '-a', 'never'],
    ask: ['-s', 'workspace-write', '-a', 'untrusted'],
    auto: ['-s', 'workspace-write', '-a', 'on-request'],
    full: ['-s', 'danger-full-access', '-a', 'never'],
  },
};

export function autonomyFlags(cli: CliId, autonomy: Autonomy): string[] {
  return [...AUTONOMY_FLAGS[cli][autonomy]];
}

/** Flags for an interactive CLI started by Edu (herdr pane mode). */
export function interactiveAutonomyFlags(cli: CliId, autonomy: Autonomy): string[] {
  return [...(INTERACTIVE_OVERRIDES[cli]?.[autonomy] ?? AUTONOMY_FLAGS[cli][autonomy])];
}

const READONLY_MECHANISM: Partial<Record<CliId, string>> = {
  claude: '--permission-mode plan',
  codex: '-s read-only',
  pi: '--tools read,grep,find,ls',
};

/** True when the CLI itself refuses writes at `readonly`, rather than Edu asking the model nicely. */
export function enforcesReadonly(cli: CliId): boolean {
  return READONLY_MECHANISM[cli] !== undefined;
}

/** Host controls only. No adapter supplies an Edu OS/network sandbox. */
export function engineCapabilities(cli: CliId): EngineCapabilities {
  const mechanism = READONLY_MECHANISM[cli];
  return { readonly: mechanism ? 'enforced' : 'unsupported', isolation: 'host',
    ...(mechanism ? { mechanism } : {}),
    limitations: [...(!mechanism ? ['Readonly enforcement is unsupported; shared-workspace steps run serially.'] : []), 'Host permission modes are not an Edu OS/network sandbox.'] };
}
