import { canonicalAnchor } from '../skills/bundle.js';
import { join, resolve, sep } from 'node:path';
import type { CliId, InstallScope } from '../core/contracts.js';

export interface CliPaths {
  instructions: string[];
  skills: string;
  agents?: string;
  mcp?: string;
  settings?: string;
  outputStyle?: string;
}

/** Targets are explicit so tests and callers never need to touch a real HOME. */
export function pathsFor(cli: CliId, scope: InstallScope, root: string, home: string): CliPaths {
  const project = scope === 'project';
  const sharedSkills = join(project ? root : home, '.agents/skills');
  switch (cli) {
    case 'claude': {
      const base = join(project ? root : home, '.claude');
      return {
        instructions: [join(project ? root : base, 'CLAUDE.md')],
        skills: join(base, 'skills'), agents: join(base, 'agents'),
        mcp: join(project ? root : home, project ? '.mcp.json' : '.claude.json'),
        settings: join(base, 'settings.json'), outputStyle: join(base, 'output-styles/edu.md'),
      };
    }
    case 'codex': return {
      instructions: [join(project ? root : join(home, '.codex'), 'AGENTS.md')],
      skills: sharedSkills, mcp: join(home, '.codex/config.toml'),
    };
    case 'pi': return {
      instructions: [join(project ? root : join(home, '.pi/agent'), 'AGENTS.md')],
      skills: sharedSkills, mcp: join(home, '.pi/agent/mcp.json'),
    };
    case 'opencode': return {
      instructions: [join(project ? root : join(home, '.config/opencode'), 'AGENTS.md')],
      skills: sharedSkills, mcp: join(project ? root : join(home, '.config/opencode'), 'opencode.json'),
    };
    case 'agy': return {
      instructions: project ? [join(root, 'GEMINI.md'), join(root, 'AGENTS.md')] : [join(home, '.gemini/GEMINI.md'), join(home, '.gemini/AGENTS.md')],
      skills: sharedSkills,
    };
  }
}

export interface BasePin { path: string; canonical: string }
/** Caller-configured bases only. A skill or helper directory is never a trusted base. */
export function configuredBases(root: string, home: string): string[] {
  return [...new Set([root, home].flatMap(base => [resolve(base), ...['.edu', '.agents', '.claude'].map(name => resolve(base, name))]).concat(['.codex', '.pi', '.config/opencode', '.gemini'].map(name => resolve(home, name))))];
}
export async function pinConfiguredBases(root: string, home: string): Promise<BasePin[]> {
  return Promise.all(configuredBases(root, home).map(async path => ({ path, canonical: await canonicalAnchor(path) })));
}
export function baseFor(path: string, pins: readonly BasePin[]): BasePin | undefined {
  const target = resolve(path);
  return pins.filter(pin => target === pin.path || target.startsWith(pin.path + sep)).sort((a, b) => b.path.length - a.path.length)[0];
}
