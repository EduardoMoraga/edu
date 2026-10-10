import { eduMcpLaunch } from '../platform/index.js';
import type { InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { instructionActions, skillActions } from './common.js';
import { pathsFor } from './paths.js';
import { createIntegration } from './integration.js';

async function plan(scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  const paths = pathsFor('pi', scope, root, options.home);
  return [
    ...instructionActions('pi', scope, root, options),
    ...await skillActions('pi', scope, root, options),
    { cli: 'pi', kind: 'json-merge', path: paths.mcp!, description: 'Register Edu MCP server', jsonPatch: { mcpServers: { edu: { ...eduMcpLaunch() } } } },
  ];
}

export function createPiIntegration(options: IntegrationOptions) { return createIntegration('pi', options, plan); }
