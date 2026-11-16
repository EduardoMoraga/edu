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

/** Each host's own configuration directory. */
export interface HostDirs { claude: string; codex: string; pi: string; opencode: string; gemini: string }

/**
 * The single place that resolves where each host keeps its configuration, honouring the variables the
 * hosts themselves read: CODEX_HOME (Codex), PI_CODING_AGENT_DIR (Pi) and CLAUDE_CONFIG_DIR (Claude).
 * Installer, setup, doctor and native-upgrade checks all read their paths from here.
 * `claudeConfig: false` keeps Claude at ~/.claude: the managed-file installer pins its skill bundles there.
 */
export function hostConfigDirs(home: string, env: NodeJS.ProcessEnv = {}, options: { claudeConfig?: boolean } = {}): HostDirs {
  return {
    claude: resolve(((options.claudeConfig ?? true) && env.CLAUDE_CONFIG_DIR) || join(home, '.claude')),
    codex: resolve(env.CODEX_HOME || join(home, '.codex')),
    pi: resolve(env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent')),
    opencode: resolve(home, '.config', 'opencode'),
    gemini: resolve(home, '.gemini'),
  };
}

/** Installer view of the host directories (see hostConfigDirs). */
export const installDirs = (home: string, env: NodeJS.ProcessEnv = {}) => hostConfigDirs(home, env, { claudeConfig: false });

/** Targets are explicit so tests and callers never need to touch a real HOME. */
export function pathsFor(cli: CliId, scope: InstallScope, root: string, home: string, dirs: HostDirs = installDirs(home)): CliPaths {
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
      instructions: [join(project ? root : dirs.codex, 'AGENTS.md')],
      skills: sharedSkills, mcp: join(dirs.codex, 'config.toml'),
    };
    case 'pi': return {
      instructions: [join(project ? root : dirs.pi, 'AGENTS.md')],
      skills: sharedSkills, mcp: join(dirs.pi, 'mcp.json'),
    };
    case 'opencode': return {
      instructions: [join(project ? root : dirs.opencode, 'AGENTS.md')],
      skills: sharedSkills, mcp: join(project ? root : dirs.opencode, 'opencode.json'),
    };
    case 'agy': return {
      instructions: project ? [join(root, 'GEMINI.md'), join(root, 'AGENTS.md')] : [join(dirs.gemini, 'GEMINI.md'), join(dirs.gemini, 'AGENTS.md')],
      skills: sharedSkills,
    };
  }
}

/** Files in HOME that every Edu installation (global and each project) shares: one owner registry tracks them. */
export function sharedTargetPaths(home: string, dirs: HostDirs = installDirs(home)): string[] {
  return [join(dirs.codex, 'config.toml'), join(dirs.pi, 'mcp.json')];
}

export interface BasePin { path: string; canonical: string }
/** Caller-configured bases only. A skill or helper directory is never a trusted base. */
export function configuredBases(root: string, home: string, dirs: HostDirs = installDirs(home)): string[] {
  return [...new Set([root, home].flatMap(base => [resolve(base), ...['.edu', '.agents', '.claude'].map(name => resolve(base, name))])
    .concat(['.codex', '.pi', '.config/opencode', '.gemini'].map(name => resolve(home, name)))
    .concat([dirs.codex, dirs.pi]))];
}
export async function pinConfiguredBases(root: string, home: string, dirs: HostDirs = installDirs(home)): Promise<BasePin[]> {
  return Promise.all(configuredBases(root, home, dirs).map(async path => ({ path, canonical: await canonicalAnchor(path) })));
}
export function baseFor(path: string, pins: readonly BasePin[]): BasePin | undefined {
  const target = resolve(path);
  return pins.filter(pin => target === pin.path || target.startsWith(pin.path + sep)).sort((a, b) => b.path.length - a.path.length)[0];
}
