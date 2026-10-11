/**
 * Detects Edu installed natively in each coding CLI (the way `edu setup` installs it), from the CLIs' own
 * config files: no CLI is spawned, so `edu doctor` stays fast and testable with a temp HOME.
 *
 *   claude    ~/.claude/settings.json `enabledPlugins["edu@…"]`, or installed_plugins.json not disabled
 *   codex     ~/.codex/config.toml `[plugins."edu@…"]` without `enabled = false`
 *   pi        ~/.pi/agent/settings.json `packages` entry for edu-agent (a local path must still exist)
 *   opencode  ~/.config/opencode (or %APPDATA%\opencode) plugins/edu.* or commands/edu-*.md
 *   agy       ~/.gemini/config/plugins/edu, ~/.gemini/antigravity-cli/plugins/edu or …/mcp/edu_edu
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import type { CliId } from '../core/contracts.js';

export interface NativeIntegration { found: string[]; notes: string[] }
export type NativeReport = Record<CliId, NativeIntegration>;

const isEduPlugin = (name: string) => /^edu@/i.test(name) || name.toLowerCase() === 'edu';

async function text(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch { return undefined; }
}
async function json(path: string): Promise<Record<string, unknown> | undefined> {
  const raw = await text(path);
  if (raw === undefined) return undefined;
  const value: unknown = parse(raw);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}
async function names(dir: string): Promise<string[]> {
  try { return await readdir(dir); } catch { return []; }
}

async function claude(home: string, env: NodeJS.ProcessEnv): Promise<NativeIntegration> {
  const dir = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const enabled = (await json(join(dir, 'settings.json')))?.enabledPlugins;
  const flags = enabled && typeof enabled === 'object' && !Array.isArray(enabled) ? enabled as Record<string, unknown> : {};
  const installed = (await json(join(dir, 'plugins', 'installed_plugins.json')))?.plugins;
  const candidates = new Set([
    ...Object.entries(flags).filter(([name, on]) => isEduPlugin(name) && on === true).map(([name]) => name),
    ...(installed && typeof installed === 'object' ? Object.keys(installed) : []).filter(name => isEduPlugin(name) && flags[name] !== false),
  ]);
  return { found: [...candidates].sort().map(name => `Claude plugin ${name}`), notes: [] };
}

async function codex(home: string, env: NodeJS.ProcessEnv): Promise<NativeIntegration> {
  const config = await text(join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'));
  const found: string[] = [];
  let current: string | undefined;
  const states = new Map<string, boolean>();
  for (const line of (config ?? '').split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]/.exec(line)?.[1];
    if (heading) {
      const plugin = /^plugins\.(?:"([^"]+)"|([^.\s]+))$/.exec(heading.trim());
      current = plugin ? plugin[1] ?? plugin[2] : undefined;
      if (current && isEduPlugin(current) && !states.has(current)) states.set(current, true);
      continue;
    }
    if (current && states.has(current) && /^\s*enabled\s*=\s*false\b/.test(line)) states.set(current, false);
  }
  for (const [name, on] of states) if (on) found.push(`Codex plugin ${name}`);
  return { found, notes: [] };
}

async function pi(home: string, env: NodeJS.ProcessEnv): Promise<NativeIntegration> {
  const dir = env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent');
  const packages = (await json(join(dir, 'settings.json')))?.packages;
  const result: NativeIntegration = { found: [], notes: [] };
  for (const entry of Array.isArray(packages) ? packages : []) {
    const source = typeof entry === 'string' ? entry : entry && typeof entry === 'object' && typeof (entry as { source?: unknown }).source === 'string' ? (entry as { source: string }).source : undefined;
    if (!source || !/(^|[/\\:@])edu-agent([/\\@#]|\.git|$)/i.test(source)) continue;
    if (/^(npm|git|https?|github):/i.test(source)) { result.found.push(`Pi package ${source}`); continue; }
    const path = isAbsolute(source) ? source : resolve(dir, source.replace(/^~(?=[/\\])/, home));
    if (await exists(path)) result.found.push(`Pi package ${source}`);
    else result.notes.push(`Pi package ${source} is registered but its folder is missing (${path}); run: edu setup --cli pi`);
  }
  return result;
}

async function opencode(home: string, env: NodeJS.ProcessEnv): Promise<NativeIntegration> {
  const found: string[] = [];
  const bases: Array<[string, string]> = [[join(home, '.config', 'opencode'), '~/.config/opencode'], ...(env.APPDATA ? [[join(env.APPDATA, 'opencode'), '%APPDATA%\\opencode'] as [string, string]] : [])];
  for (const [base, label] of bases) {
    const parts: string[] = [];
    const plugin = (await names(join(base, 'plugins'))).find(name => /^edu\.(ts|js|mjs)$/.test(name));
    if (plugin) parts.push(`plugins/${plugin}`);
    if ((await names(join(base, 'commands'))).some(name => /^edu-.+\.md$/.test(name))) parts.push('commands/edu-*.md');
    if (parts.length) found.push(`OpenCode files ${label} (${parts.join(', ')})`);
  }
  return { found, notes: [] };
}

async function agy(home: string): Promise<NativeIntegration> {
  const found: string[] = [];
  for (const relative of ['.gemini/config/plugins/edu', '.gemini/antigravity-cli/plugins/edu', '.gemini/antigravity-cli/mcp/edu_edu']) {
    if (await exists(join(home, ...relative.split('/')))) found.push(`Antigravity plugin ~/${relative}`);
  }
  return { found, notes: [] };
}

/** Native Edu installs per CLI. `home` is the user's home (USERPROFILE on Windows). */
export async function nativeIntegrations(home: string, env: NodeJS.ProcessEnv = {}): Promise<NativeReport> {
  const [c, x, p, o, a] = await Promise.all([claude(home, env), codex(home, env), pi(home, env), opencode(home, env), agy(home)]);
  return { claude: c, codex: x, pi: p, opencode: o, agy: a };
}
