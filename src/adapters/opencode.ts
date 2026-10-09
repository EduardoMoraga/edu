import type { InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { agentTemplates, instructionActions, skillActions } from './common.js';
import { pathsFor } from './paths.js';
import { createIntegration } from './integration.js';

async function plan(scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  const paths = pathsFor('opencode', scope, root, options.home);
  const agents: Record<string, unknown> = {};
  for (const agent of await agentTemplates(options.templatesDir)) {
    agents[agent.name] = { description: agent.description, prompt: agent.prompt, mode: 'subagent' };
  }
  return [
    ...instructionActions('opencode', scope, root, options),
    ...await skillActions('opencode', scope, root, options),
    { cli: 'opencode', kind: 'json-merge', path: paths.mcp!, description: 'Register Edu MCP server and agents', jsonPatch: { mcp: { edu: { type: 'local', command: ['edu', 'mcp'], enabled: true } }, agent: agents } },
  ];
}

export function createOpenCodeIntegration(options: IntegrationOptions) { return createIntegration('opencode', options, plan); }
