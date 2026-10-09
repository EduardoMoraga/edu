import type { Autonomy, CliId } from '../core/contracts.js';

/** The sole source of CLI autonomy flags. Empty arrays mean the CLI has no mapping. */
export const AUTONOMY_FLAGS: Record<CliId, Record<Autonomy, readonly string[]>> = {
  claude: {
    readonly: ['--permission-mode', 'plan'],
    ask: ['--permission-mode', 'default'],
    auto: ['--permission-mode', 'acceptEdits'],
    full: ['--permission-mode', 'bypassPermissions'],
  },
  codex: {
    readonly: ['-s', 'read-only'],
    ask: ['-s', 'workspace-write'],
    auto: ['-s', 'workspace-write'],
    full: ['-s', 'danger-full-access'],
  },
  pi: { readonly: [], ask: [], auto: [], full: [] },
  opencode: { readonly: [], ask: [], auto: [], full: [] },
  agy: { readonly: [], ask: [], auto: [], full: ['--dangerously-skip-permissions'] },
};

export function autonomyFlags(cli: CliId, autonomy: Autonomy): string[] {
  return [...AUTONOMY_FLAGS[cli][autonomy]];
}
