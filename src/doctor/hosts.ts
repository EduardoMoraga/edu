import { join, win32 } from 'node:path';

export const HOST_IDS = ['claude', 'codex', 'pi', 'opencode', 'gemini'] as const;
export type HostId = typeof HOST_IDS[number];
export type FileKind = 'instructions' | 'json' | 'jsonc' | 'toml' | 'hooks';
export interface HostFile { host: HostId; path: string; relative: string; kind: FileKind }

const FILES: Record<HostId, readonly [string, FileKind][]> = {
  claude: [['.claude/CLAUDE.md', 'instructions'], ['.claude/settings.json', 'json'], ['.claude.json', 'json']],
  codex: [['.codex/AGENTS.md', 'instructions'], ['.codex/config.toml', 'toml'], ['.codex/hooks.json', 'hooks']],
  pi: [['.pi/agent/AGENTS.md', 'instructions'], ['.pi/agent/settings.json', 'json'], ['.pi/agent/mcp.json', 'json']],
  opencode: [['.config/opencode/AGENTS.md', 'instructions'], ['.config/opencode/opencode.json', 'json'], ['.config/opencode/opencode.jsonc', 'jsonc']],
  gemini: [['.gemini/GEMINI.md', 'instructions'], ['.gemini/settings.json', 'json']],
};

export const SKILL_DIRS: Partial<Record<HostId, readonly string[]>> = {
  claude: ['.claude/skills', '.claude/agents'],
  codex: ['.codex/skills', '.agents/skills'],
  pi: ['.pi/agent/skills', '.pi/agent/extensions'],
  opencode: ['.config/opencode/skills', '.config/opencode/plugins'],
  gemini: ['.gemini/skills'],
};

export function hostFiles(home: string, env: NodeJS.ProcessEnv = {}, hosts: readonly HostId[] = HOST_IDS): HostFile[] {
  const root = env.USERPROFILE || home;
  return hosts.flatMap((host) => FILES[host].map(([relative, kind]) => {
    const pathJoin = /^[A-Za-z]:\\|^\\\\/.test(root) ? win32.join : join;
    const path = host === 'opencode' && env.APPDATA && relative.startsWith('.config/opencode/')
      ? (/^[A-Za-z]:\\|^\\\\/.test(env.APPDATA) ? win32.join : join)(env.APPDATA, relative.slice('.config/'.length)) : pathJoin(root, relative);
    return { host, path, relative, kind };
  }));
}

export function parseHosts(value?: string): HostId[] {
  if (!value) return [...HOST_IDS];
  const hosts = value.split(',').map((host) => host.trim());
  const invalid = hosts.filter((host) => !(HOST_IDS as readonly string[]).includes(host));
  if (invalid.length) throw new Error(`Unknown host: ${invalid.join(', ')}`);
  return [...new Set(hosts)] as HostId[];
}
