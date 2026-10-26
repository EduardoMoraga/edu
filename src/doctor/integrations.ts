import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Requirements-level compatibility policy; never loads third-party executable code. */
export const OPTIONAL_INTEGRATIONS = [
  { id: 'pi-subagents', capability: 'delegation', license: 'unverified', state: 'optional', overlap: 'Edu Crew owns execution; child recursion and memory writes must be disabled.' },
  { id: 'billion-context', capability: 'reversible compression', license: 'unverified', state: 'experimental', overlap: 'Not persistent memory. Disable its native delegation; no endpoint rewrites or self-updates.' },
  { id: 'openwiki', capability: 'derived repository retrieval', license: 'unverified', state: 'optional', overlap: 'Not canonical memory. No secrets, publishing or tracing; review managed instruction blocks.' },
  { id: 'context-mode', capability: 'tool output filtering', license: 'ELv2', state: 'external-only', overlap: 'Never vendor or bundle into MIT Edu. Not an OS sandbox; native artifact retrieval is independent.' },
  { id: 'pi-goal-x', capability: 'goal continuation', license: 'unverified', state: 'conflicting-owner', overlap: 'Edu run owns goals and approvals. Do not enable a second continuation owner.' },
  { id: 'pi-advisor-flow', capability: 'advisory consultation', license: 'unverified', state: 'optional', overlap: 'Explicit disclosure and hard consultation limits required; not an independent evidence review.' },
] as const;

export async function integrationPreflight(home: string, env: NodeJS.ProcessEnv = {}) {
  const dir = env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent');
  let sources: string[] = [];
  let configuration: 'read' | 'missing' | 'invalid' = 'missing';
  try {
    const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'));
    configuration = 'read';
    if (Array.isArray(settings.packages)) sources = settings.packages.flatMap((entry: unknown) => {
      const value = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? (entry as { source?: unknown }).source : undefined;
      return typeof value === 'string' ? [value] : [];
    });
  } catch (error) { configuration = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid'; }
  return {
    configuration,
    diagnostic: 'Configuration-only preflight: registered is not installed, compatible, active or authenticated. All integrations default off in Edu. No package is loaded or installed.',
    piToolDiscovery: 'In Pi 1.4, MCP codemode/deferred tools require an active reachable codemode or tool_search tool. If neither is present, inspect /mcp and active tools; reinstalling Edu is not a verified fix. CLI fallback: edu brief / edu brain --help in the same workspace.',
    integrations: OPTIONAL_INTEGRATIONS.map(entry => ({ ...entry, defaultEnabled: false, registered: sources.some(source => new RegExp(`(?:^|[/@:])${entry.id}(?:$|[@/#])`, 'i').test(source)), authentication: 'unknown' as const, runtimeCompatibility: 'unverified' as const })),
  };
}
