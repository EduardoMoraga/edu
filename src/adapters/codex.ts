import type { InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { instructionActions, skillActions } from './common.js';
import { pathsFor } from './paths.js';
import { createIntegration } from './integration.js';

async function plan(scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  const paths = pathsFor('codex', scope, root, options.home);
  return [
    ...instructionActions('codex', scope, root, options),
    ...await skillActions('codex', scope, root, options),
    { cli: 'codex', kind: 'toml-merge', path: paths.mcp!, description: 'Register Edu MCP server and Codex notify hook', tomlBody: 'notify = ["edu", "hook", "codex-notify"]\n\n[mcp_servers.edu]\ncommand = "edu"\nargs = ["mcp"]' },
  ];
}

export function createCodexIntegration(options: IntegrationOptions) { return createIntegration('codex', options, plan); }
