import { eduMcpLaunch } from '../platform/index.js';
import { dirname, join } from 'node:path';
import type { InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { instructionActions, skillActions } from './common.js';
import { pathsFor } from './paths.js';
import { createIntegration } from './integration.js';

/**
 * The argv Codex runs after each turn; Codex appends one JSON argument with the turn's last message.
 * Codex starts it without a shell, so on Windows the `edu.cmd` shim cannot be found by name. Unlike the
 * MCP entry (fixed arguments), this argv carries model output, so it must never pass through cmd.exe,
 * whose parser would treat `&` or `|` in that text as commands: run Node with Edu's script directly.
 */
export function codexNotifyArgv(templatesDir: string, platform: NodeJS.Platform = process.platform, execPath = process.execPath): string[] {
  if (platform !== 'win32') return ['edu', 'hook', 'codex-notify'];
  return [execPath, join(dirname(templatesDir), 'dist', 'cli.js'), 'hook', 'codex-notify'];
}

async function plan(scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  const paths = pathsFor('codex', scope, root, options.home, options.dirs);
  const launch = eduMcpLaunch(options.platform);
  return [
    ...instructionActions('codex', scope, root, options),
    ...await skillActions('codex', scope, root, options),
    { cli: 'codex', kind: 'toml-merge', path: paths.mcp!, description: 'Register Edu MCP server and Codex notify hook', tomlBody: `notify = [${codexNotifyArgv(options.templatesDir, options.platform).map(arg => JSON.stringify(arg)).join(', ')}]\n\n[mcp_servers.edu]\ncommand = ${JSON.stringify(launch.command)}\nargs = ${JSON.stringify(launch.args)}` },
  ];
}

export function createCodexIntegration(options: IntegrationOptions) { return createIntegration('codex', options, plan); }
