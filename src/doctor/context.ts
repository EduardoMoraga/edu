import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parse } from 'jsonc-parser';
import { editInstructions } from '../detach/edit.js';
import { ownerOf, SIGNATURES, TOOL_IDS, type ToolId } from '../detach/signatures.js';
import { hostFiles, SKILL_DIRS, type HostId } from './hosts.js';

export interface HostContext {
  host: HostId;
  tokens: { total: number; byOwner: Record<string, number> };
  hooks: { total: number; byOwner: Record<string, number> };
  mcpServers: { total: number; byOwner: Record<string, number>; names: string[] };
  plugins: string[];
  memoryWriters: ToolId[];
  orchestrationProtocols: ToolId[];
  competingMemory: boolean;
  competingOrchestration: boolean;
  detachCommand: string | null;
  warnings: string[];
}
export interface ContextReport { hosts: HostContext[] }

const add = (counts: Record<string, number>, owner: string, amount = 1) => { counts[owner] = (counts[owner] ?? 0) + amount; };
async function safeText(path: string, home: string): Promise<string | undefined> {
  const lexical = relative(resolve(home), resolve(path));
  if (lexical === '..' || lexical.startsWith(`..${sep}`)) return undefined;
  try {
    const info = await lstat(path);
    if (!info.isFile() && !info.isSymbolicLink()) return undefined;
    const target = await realpath(path);
    const rel = relative(await realpath(home), target);
    if (rel === '..' || rel.startsWith(`..${sep}`)) return undefined;
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function skillDescriptions(home: string, host: HostId, env: NodeJS.ProcessEnv): Promise<Array<{ owner: string; chars: number }>> {
  const root = env.USERPROFILE || home;
  const descriptions: Array<{ owner: string; chars: number }> = [];
  for (const dir of SKILL_DIRS[host] ?? []) {
    const base = join(host === 'opencode' && env.APPDATA ? env.APPDATA : root, host === 'opencode' && env.APPDATA ? dir.slice('.config/'.length) : dir);
    let entries;
    try { entries = await readdir(base, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const text = await safeText(join(base, entry.name, 'SKILL.md'), root);
      if (!text) continue;
      const description = /^description:\s*(.+)$/m.exec(text)?.[1];
      if (description) descriptions.push({ owner: ownerOf(entry.name, 'plugins') ?? 'user', chars: description.length });
    }
  }
  return descriptions;
}

function scanHooks(value: unknown, counts: Record<string, number>): void {
  if (Array.isArray(value)) { for (const child of value) scanHooks(child, counts); return; }
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  const command = typeof object.command === 'string' ? object.command : Array.isArray(object.command) ? object.command.join(' ') : undefined;
  if (command) { add(counts, ownerOf(command, 'commands') ?? 'user'); return; }
  for (const child of Object.values(object)) scanHooks(child, counts);
}

function scanObject(value: Record<string, unknown>, report: HostContext, owners: Set<ToolId>): void {
  scanHooks(value.hooks, report.hooks.byOwner);
  for (const key of ['mcpServers', 'mcp_servers', 'mcp']) {
    const servers = value[key];
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
    for (const name of Object.keys(servers)) {
      report.mcpServers.names.push(name);
      const owner = ownerOf(name, 'mcp');
      add(report.mcpServers.byOwner, owner ?? 'user');
      if (owner) owners.add(owner);
    }
  }
  for (const key of ['enabledPlugins', 'plugins']) {
    const plugins = value[key];
    const names = Array.isArray(plugins) ? plugins.filter((item): item is string => typeof item === 'string')
      : plugins && typeof plugins === 'object' ? Object.entries(plugins).filter(([, enabled]) => enabled !== false).map(([name]) => name) : [];
    for (const name of names) { report.plugins.push(name); const owner = ownerOf(name, 'plugins'); if (owner) owners.add(owner); }
  }
  if (Array.isArray(value.packages)) for (const item of value.packages) if (typeof item === 'string') { const owner = ownerOf(item, 'packages'); if (owner) owners.add(owner); }
  if (value.outputStyle === SIGNATURES['gentle-ai'].extras?.claudeOutputStyle || value.default_agent === SIGNATURES['gentle-ai'].extras?.opencodeDefaultAgent) owners.add('gentle-ai');
  const status = value.statusLine;
  if (status && typeof status === 'object') {
    const command = (status as Record<string, unknown>).command;
    if (typeof command === 'string') { const owner = ownerOf(command, 'commands'); if (owner) owners.add(owner); }
  }
}

function scanToml(text: string, report: HostContext, owners: Set<ToolId>): void {
  const pluginStates = new Map<string, boolean>();
  let activePlugin: string | undefined;
  for (const line of text.split('\n')) {
    const heading = /^\s*\[([^\]]+)\]/.exec(line)?.[1];
    if (heading) {
      const mcp = /^mcp_servers\.(?:"([^"]+)"|([^.]+))/.exec(heading);
      const plugin = /^plugins\.(?:"([^"]+)"|([^.]+))/.exec(heading);
      activePlugin = plugin?.[1] ?? plugin?.[2];
      if (mcp) { const name = mcp[1] ?? mcp[2]!; if (!report.mcpServers.names.includes(name)) { report.mcpServers.names.push(name); const owner = ownerOf(name, 'mcp'); add(report.mcpServers.byOwner, owner ?? 'user'); if (owner) owners.add(owner); } }
      if (activePlugin && !pluginStates.has(activePlugin)) pluginStates.set(activePlugin, true);
    }
    if (activePlugin && /^\s*enabled\s*=\s*false\b/.test(line)) pluginStates.set(activePlugin, false);
    if (SIGNATURES.engram.extras?.codexInstructionKeys?.some((key) => new RegExp(`^\\s*${key}\\s*=`).test(line) && /engram/i.test(line))) owners.add('engram');
  }
  for (const [name, enabled] of pluginStates) if (enabled) { report.plugins.push(name); const owner = ownerOf(name, 'plugins'); if (owner) owners.add(owner); }
}

export async function scanContext(input: { home: string; env: NodeJS.ProcessEnv; hosts?: HostId[] }): Promise<ContextReport> {
  const hosts: HostContext[] = [];
  for (const host of input.hosts ?? ['claude', 'codex', 'pi', 'opencode', 'gemini']) {
    const report: HostContext = { host, tokens: { total: 0, byOwner: {} }, hooks: { total: 0, byOwner: {} }, mcpServers: { total: 0, byOwner: {}, names: [] }, plugins: [], memoryWriters: [], orchestrationProtocols: [], competingMemory: false, competingOrchestration: false, detachCommand: null, warnings: [] };
    const owners = new Set<ToolId>();
    let found = false; let codexToml = '';
    for (const file of hostFiles(input.home, input.env, [host])) {
      const text = await safeText(file.path, input.env.USERPROFILE || input.home);
      if (text === undefined) continue;
      found = true;
      if (file.kind === 'instructions') {
        const chars = text.length;
        let assigned = 0;
        for (const owner of TOOL_IDS) {
          const removed = chars - editInstructions(text, [owner]).text.length;
          if (removed) { add(report.tokens.byOwner, owner, Math.round(removed / 4)); assigned += removed; owners.add(owner); }
        }
        add(report.tokens.byOwner, 'user', Math.round(Math.max(0, chars - assigned) / 4));
        report.tokens.total += Math.round(chars / 4);
      } else if (file.kind === 'toml') { codexToml = text; scanToml(text, report, owners); }
      else {
        try { scanObject((file.kind === 'jsonc' ? parse(text) : JSON.parse(text)) as Record<string, unknown>, report, owners); }
        catch { report.warnings.push(`Could not parse ${file.relative}`); }
      }
    }
    if (!found) continue;
    // Codex may inject referenced instruction files beyond AGENTS.md.
    if (host === 'codex') {
      const home = input.env.USERPROFILE || input.home;
      const seen = new Set<string>();
      for (const key of SIGNATURES.engram.extras?.codexInstructionKeys ?? []) {
        const value = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm').exec(codexToml)?.[1];
        if (!value || !value.toLowerCase().includes('engram')) continue;
        const path = value.startsWith('~/') ? join(home, value.slice(2)) : resolve(home, value);
        if (seen.has(path)) continue;
        seen.add(path);
        const text = await safeText(path, home);
        if (text) { const count = Math.round(text.length / 4); add(report.tokens.byOwner, 'engram', count); report.tokens.total += count; owners.add('engram'); }
      }
    }
    for (const description of await skillDescriptions(input.home, host, input.env)) { const count = Math.round(description.chars / 4); add(report.tokens.byOwner, description.owner, count); report.tokens.total += count; }
    report.hooks.total = Object.values(report.hooks.byOwner).reduce((a, b) => a + b, 0);
    report.mcpServers.total = report.mcpServers.names.length;
    for (const owner of Object.keys(report.hooks.byOwner)) if (owner !== 'user') owners.add(owner as ToolId);
    report.memoryWriters = TOOL_IDS.filter((id) => owners.has(id) && SIGNATURES[id].memoryWriter);
    report.orchestrationProtocols = TOOL_IDS.filter((id) => owners.has(id) && SIGNATURES[id].orchestrator);
    report.competingMemory = report.memoryWriters.length > 1;
    report.competingOrchestration = report.orchestrationProtocols.length > 1;
    const removable = TOOL_IDS.filter((id) => id !== 'edu' && owners.has(id));
    report.detachCommand = removable.length ? `edu detach ${removable.join(' ')} --host ${host}` : null;
    hosts.push(report);
  }
  return { hosts };
}
