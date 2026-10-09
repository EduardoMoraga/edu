import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstallScope } from '../core/contracts.js';
import type { IntegrationOptions, PlannedAction } from './types.js';
import { agentTemplates, instructionActions, skillActions } from './common.js';
import { pathsFor } from './paths.js';
import { createIntegration } from './integration.js';

async function plan(scope: InstallScope, root: string, options: IntegrationOptions): Promise<PlannedAction[]> {
  const paths = pathsFor('claude', scope, root, options.home);
  const actions = [...instructionActions('claude', scope, root, options), ...await skillActions('claude', scope, root, options)];
  for (const agent of await agentTemplates(options.templatesDir)) {
    const header = `---\nname: ${agent.name}\ndescription: ${JSON.stringify(agent.description)}\ntools: ${agent.tools}\n---\n`;
    actions.push({ cli: 'claude', kind: 'file', path: join(paths.agents!, `${agent.name}.md`), description: `Install ${agent.name} subagent`, content: `${header}\n${agent.prompt}\n` });
  }
  actions.push({ cli: 'claude', kind: 'json-merge', path: paths.mcp!, description: 'Register Edu MCP server', jsonPatch: { mcpServers: { edu: { command: 'edu', args: ['mcp'] } } } });
  const identityPath = join(scope === 'project' ? root : options.home, '.edu/EDU.md');
  const identity = await readFile(identityPath, 'utf8').catch(() => readFile(join(options.templatesDir, 'EDU.md'), 'utf8'));
  const voice = identity.match(/\*\*Voice\.\*\*[\s\S]*?(?=\n\n|$)/)?.[0] ?? 'Direct, warm, evidence-first.';
  actions.push({ cli: 'claude', kind: 'file', path: paths.outputStyle!, description: 'Install Edu output style', content: `# Edu output style\n\n${voice}\n` });
  actions.push({ cli: 'claude', kind: 'json-merge', path: paths.settings!, description: 'Register Edu statusline and lifecycle hooks', jsonPatch: {
    statusLine: { type: 'command', command: 'edu statusline' },
    hooks: {
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'edu hook session-start' }] }],
      SessionEnd: [{ matcher: '*', hooks: [{ type: 'command', command: 'edu hook session-end' }] }],
    },
  } });
  return actions;
}

export function createClaudeIntegration(options: IntegrationOptions) { return createIntegration('claude', options, plan); }
