import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import type { FileKind, HostId } from '../doctor/hosts.js';
import { ownerOf, SIGNATURES, type ToolId } from './signatures.js';

export interface EditResult { text: string; changes: string[] }
const selected = (value: string, field: 'commands' | 'mcp' | 'plugins' | 'packages', tools: readonly ToolId[]) => {
  const owner = ownerOf(value, field);
  return owner !== undefined && tools.includes(owner);
};

export function editInstructions(input: string, tools: readonly ToolId[]): EditResult {
  const marker = /<!--\s*(\/)?([\w-]+):([\w-]+)\s*-->/g;
  const stack: Array<{ owner: string; name: string; start: number }> = [];
  const spans: Array<{ start: number; end: number; keep: string }> = [];
  for (const match of input.matchAll(marker)) {
    const [token, close, owner, name] = match;
    const at = match.index;
    if (!close) { stack.push({ owner: owner!, name: name!, start: at }); continue; }
    // Find the matching opener; markers of other styles left open inside it (e.g. `<!-- x:start -->`)
    // are plain text, not structure, so they are discarded with it.
    const index = stack.findLastIndex((item) => item.owner === owner && item.name === name);
    if (index < 0) continue;
    const last = stack[index]!;
    stack.length = index;
    const tool = tools.find((id) => SIGNATURES[id].marker === owner);
    if (tool && !stack.some((item) => tools.some((id) => SIGNATURES[id].marker === item.owner))) {
      const body = input.slice(last.start + input.slice(last.start).indexOf('-->') + 3, at);
      spans.push({ start: last.start, end: at + token.length, keep: keptSections(body, SIGNATURES[tool].keepSections?.[name!] ?? []) });
    }
  }
  // An unmatched marker must never cause deletion; only closed outermost spans qualify.
  let text = input;
  for (const { start, end, keep } of spans.sort((a, b) => b.start - a.start)) text = text.slice(0, start) + keep + text.slice(end);
  if (spans.length) text = text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return { text, changes: spans.map((span) => span.keep ? 'instruction block (your sections kept)' : 'instruction block') };
}

/** Returns the `## <title>` sections (heading + body) to keep, in their original order. */
function keptSections(body: string, titles: readonly string[]): string {
  if (!titles.length) return '';
  const parts = body.split(/(?=^## )/m);
  const kept = parts.filter((part) => {
    const title = /^## (.+)$/m.exec(part)?.[1]?.trim();
    return title !== undefined && titles.includes(title);
  });
  return kept.length ? `${kept.map((part) => part.trimEnd()).join('\n\n')}\n` : '';
}

function commandOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.command === 'string') return record.command;
  if (Array.isArray(record.command)) return record.command.filter((part): part is string => typeof part === 'string').join(' ');
  return undefined;
}

function pruneHooks(value: unknown, tools: readonly ToolId[], changes: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => pruneHooks(item, tools, changes)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  const command = commandOf(object);
  if (command && selected(command, 'commands', tools)) { changes.push(`hook: ${ownerOf(command, 'commands')}`); return undefined; }
  const result: Record<string, unknown> = { ...object };
  for (const [key, child] of Object.entries(object)) {
    if (key === 'hooks' || key === 'handlers' || Array.isArray(child)) {
      const next = pruneHooks(child, tools, changes);
      if (Array.isArray(next) && next.length === 0 && (key === 'hooks' || key === 'handlers')) return undefined;
      result[key] = next;
    }
  }
  return result;
}

function editObject(input: Record<string, unknown>, host: HostId, tools: readonly ToolId[], changes: string[]): Record<string, unknown> {
  const result = structuredClone(input);
  for (const key of ['mcpServers', 'mcp_servers', 'mcp']) {
    const servers = result[key];
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
    for (const id of Object.keys(servers)) if (selected(id, 'mcp', tools)) { delete (servers as Record<string, unknown>)[id]; changes.push(`MCP: ${id}`); }
  }
  for (const key of ['enabledPlugins', 'plugins']) {
    const plugins = result[key];
    if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
      for (const id of Object.keys(plugins)) if (selected(id, 'plugins', tools)) { delete (plugins as Record<string, unknown>)[id]; changes.push(`plugin: ${id}`); }
    } else if (Array.isArray(plugins)) {
      result[key] = plugins.filter((item) => {
        const remove = typeof item === 'string' && selected(item, 'plugins', tools);
        if (remove) changes.push(`plugin: ${item}`);
        return !remove;
      });
    }
  }
  if (host === 'pi' && Array.isArray(result.packages)) {
    result.packages = result.packages.filter((item) => {
      const remove = typeof item === 'string' && selected(item, 'packages', tools);
      if (remove) changes.push(`package: ${item}`);
      return !remove;
    });
  }
  if (host === 'claude') {
    if (tools.some((tool) => SIGNATURES[tool].extras?.claudeOutputStyle === result.outputStyle)) { delete result.outputStyle; changes.push('outputStyle'); }
    const status = commandOf(result.statusLine);
    if (status && selected(status, 'commands', tools)) { delete result.statusLine; changes.push('statusLine'); }
  }
  if (host === 'opencode' && tools.some((tool) => SIGNATURES[tool].extras?.opencodeDefaultAgent === result.default_agent)) {
    delete result.default_agent; changes.push('default_agent');
  }
  if (result.hooks) {
    const hooks = pruneHooks(result.hooks, tools, changes);
    result.hooks = hooks ?? {};
  }
  return result;
}

function jsonEdit(input: string, host: HostId, tools: readonly ToolId[], jsonc: boolean): EditResult {
  const errors: ParseError[] = [];
  const value = jsonc ? parse(input, errors, { allowTrailingComma: true }) : JSON.parse(input) as unknown;
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid host configuration; refusing partial edit');
  const changes: string[] = [];
  const result = editObject(value as Record<string, unknown>, host, tools, changes);
  if (!changes.length) return { text: input, changes };
  if (!jsonc) return { text: `${JSON.stringify(result, null, 2)}\n`, changes };
  let text = input;
  // Applying leaf edits preserves JSONC comments and all unrelated whitespace.
  const before = value as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(result)])) {
    const oldValue = before[key];
    const newValue = result[key];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    if (oldValue && newValue && typeof oldValue === 'object' && typeof newValue === 'object' && !Array.isArray(oldValue) && !Array.isArray(newValue)) {
      const oldMap = oldValue as Record<string, unknown>;
      const newMap = newValue as Record<string, unknown>;
      for (const child of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
        if (JSON.stringify(oldMap[child]) === JSON.stringify(newMap[child])) continue;
        text = applyEdits(text, modify(text, [key, child], newMap[child], { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
      }
    } else {
      text = applyEdits(text, modify(text, [key], newValue, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
    }
  }
  return { text, changes };
}

function bracketDepth(text: string): number {
  let depth = 0; let quote = ''; let escaped = false;
  for (const c of text) {
    if (escaped) { escaped = false; continue; }
    if (quote && c === '\\') { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#') break;
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
  }
  return depth;
}

function tomlEdit(input: string, tools: readonly ToolId[]): EditResult {
  const lines = input.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const changes: string[] = [];
  const output: string[] = [];
  let section = ''; let dropSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^\s*\[{1,2}(.+?)\]{1,2}\s*(?:#.*)?(?:\n)?$/.exec(line);
    if (heading) {
      section = heading[1]!.trim();
      const plugin = /^plugins\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const mcp = /^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const market = /^marketplaces\.(?:"([^"]+)"|'([^']+)'|([^.]+))/.exec(section);
      const id = plugin?.[1] || plugin?.[2] || plugin?.[3] || mcp?.[1] || mcp?.[2] || mcp?.[3] || market?.[1] || market?.[2] || market?.[3];
      dropSection = Boolean(id && selected(id, plugin || market ? 'plugins' : 'mcp', tools));
      if (dropSection) changes.push(`${plugin ? 'plugin' : market ? 'marketplace' : 'MCP'}: ${id}`);
    }
    if (dropSection) continue;
    if (!section) {
      const key = /^\s*([\w-]+)\s*=\s*(.*?)(?:\n)?$/.exec(line);
      if (key) {
        const [statement] = key;
        let end = i; let depth = bracketDepth(statement);
        while (depth > 0 && end + 1 < lines.length) depth += bracketDepth(lines[++end]!);
        const raw = lines.slice(i, end + 1).join('');
        const remove = (tools.some((tool) => SIGNATURES[tool].extras?.codexInstructionKeys?.includes(key[1]!) && raw.toLowerCase().includes(tool)))
          || (key[1] === 'notify' && tools.some((tool) => SIGNATURES[tool].commands.some((part) => raw.toLowerCase().includes(part))));
        if (remove) { changes.push(`config: ${key[1]}`); i = end; continue; }
      }
    }
    output.push(line);
  }
  return { text: output.join(''), changes };
}

export function editContent(kind: FileKind, host: HostId, input: string, tools: readonly ToolId[]): EditResult {
  if (kind === 'instructions') return editInstructions(input, tools);
  if (kind === 'toml') return tomlEdit(input, tools);
  return jsonEdit(input, host, tools, kind === 'jsonc');
}
