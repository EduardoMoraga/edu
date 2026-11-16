import { applyEdits, findNodeAtLocation, modify, parse, parseTree, type ParseError } from 'jsonc-parser';
import type { FileKind, HostId } from '../adapters/host-files.js';
import { ownerOf, SIGNATURES, type ToolId } from './signatures.js';
import { jsoncFormatFor, serializeLike } from '../adapters/merge.js';
import { scanTomlLines, type TomlLine } from '../adapters/toml.js';

export interface EditResult { text: string; changes: string[] }
const selected = (value: string, field: 'commands' | 'mcp' | 'plugins' | 'packages', tools: readonly ToolId[]) => {
  const owner = ownerOf(value, field);
  return owner !== undefined && tools.includes(owner);
};
/** Plugin entries that are file paths are owned by their file name, never by the folders above it. */
const pluginName = (value: string) => /[\\/]/.test(value) ? value.split(/[\\/]/).filter(Boolean).at(-1) ?? value : value;

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
  // `plugin` is OpenCode's list (opencode.json and OpenCode 1 tui.json) and `plugins` OpenCode 2's (cli.json),
  // e.g. a TUI logo plugin's absolute path.
  for (const key of ['enabledPlugins', 'plugins', 'plugin']) {
    const plugins = result[key];
    if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
      for (const id of Object.keys(plugins)) if (selected(id, 'plugins', tools)) { delete (plugins as Record<string, unknown>)[id]; changes.push(`plugin: ${id}`); }
    } else if (Array.isArray(plugins)) {
      result[key] = plugins.filter((item) => {
        const remove = typeof item === 'string' && selected(pluginName(item), 'plugins', tools);
        if (remove) changes.push(`plugin: ${pluginName(item)}`);
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
  // Edits keep the user's indentation and line endings.
  if (!jsonc) return { text: serializeLike(input, result), changes };
  let text = input;
  const format = jsoncFormatFor(input);
  // Applying leaf edits preserves JSONC comments and all unrelated whitespace.
  const before = value as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(result)])) {
    const oldValue = before[key];
    const newValue = result[key];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      // Drop removed items one by one so comments on the entries that stay are kept.
      const removed = removedIndexes(oldValue, newValue);
      if (removed) {
        for (const index of removed.reverse()) text = removeArrayItem(text, [key, index]);
        continue;
      }
    }
    if (oldValue && newValue && typeof oldValue === 'object' && typeof newValue === 'object' && !Array.isArray(oldValue) && !Array.isArray(newValue)) {
      const oldMap = oldValue as Record<string, unknown>;
      const newMap = newValue as Record<string, unknown>;
      for (const child of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
        if (JSON.stringify(oldMap[child]) === JSON.stringify(newMap[child])) continue;
        text = applyEdits(text, modify(text, [key, child], newMap[child], format));
      }
    } else {
      text = applyEdits(text, modify(text, [key], newValue, format));
    }
  }
  return { text, changes };
}

/**
 * Cuts one array element out of JSONC text: the value and its own comma only, so comments that
 * belong to neighbouring entries stay (jsonc-parser's modify would take the previous comment too).
 */
export function removeArrayItem(text: string, path: [string, number]): string {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const node = root && findNodeAtLocation(root, path);
  if (!node) return text;
  let start = node.offset;
  let end = node.offset + node.length;
  const comma = /^[ \t]*,/.exec(text.slice(end));
  if (comma) end += comma[0].length;
  else {
    const previous = /,\s*$/.exec(text.slice(0, start));
    if (previous) start = previous.index;
  }
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline < 0 ? text.length : newline;
  if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) { start = lineStart; end = newline < 0 ? text.length : newline + 1; }
  return text.slice(0, start) + text.slice(end);
}

/** Indexes of `before` missing from `after` when `after` is `before` minus some items, in order. */
function removedIndexes(before: unknown[], after: unknown[]): number[] | undefined {
  const removed: number[] = [];
  let next = 0;
  before.forEach((item, index) => {
    if (next < after.length && JSON.stringify(after[next]) === JSON.stringify(item)) next++;
    else removed.push(index);
  });
  return next === after.length ? removed : undefined;
}

/** Tables (and keys) a tool owns in Codex config.toml: `mcp_servers.<id>`, `plugins.<id>`, `marketplaces.<id>`. */
const TOML_OWNED: Readonly<Record<string, { field: 'mcp' | 'plugins'; label: string }>> = {
  mcp_servers: { field: 'mcp', label: 'MCP' }, plugins: { field: 'plugins', label: 'plugin' }, marketplaces: { field: 'plugins', label: 'marketplace' },
};

/** The change to record when `path` names an entry of a selected tool, in any TOML spelling. */
function ownedTomlEntry(path: readonly string[], tools: readonly ToolId[]): string | undefined {
  const [root, id] = path;
  const owned = root ? TOML_OWNED[root] : undefined;
  return owned && id && selected(id, owned.field, tools) ? `${owned.label}: ${id}` : undefined;
}

/** A top-level key (Codex instruction files, `notify`) whose value points at a selected tool. */
function ownedTopLevelKey(key: string, statement: string, tools: readonly ToolId[]): string | undefined {
  const text = statement.toLowerCase();
  const remove = tools.some(tool => SIGNATURES[tool].extras?.codexInstructionKeys?.includes(key) && text.includes(tool))
    || (key === 'notify' && tools.some(tool => SIGNATURES[tool].commands.some(part => text.includes(part))));
  return remove ? `config: ${key}` : undefined;
}

function tomlEdit(input: string, tools: readonly ToolId[]): EditResult {
  // One statement per group: a header, a key with its multi-line value, or a blank/comment line.
  const statements: TomlLine[][] = [];
  for (const line of scanTomlLines(input)) {
    if (line.continuation && statements.length) statements.at(-1)!.push(line);
    else statements.push([line]);
  }
  const changes: string[] = [];
  let output = '';
  let dropTable = false;
  for (const statement of statements) {
    const first = statement[0]!;
    const text = statement.map(line => line.text + line.eol).join('');
    if (first.header) {
      const change = first.header.path && ownedTomlEntry(first.header.path, tools);
      dropTable = Boolean(change);
      if (change) changes.push(change);
    }
    if (dropTable) continue;
    if (first.key) {
      const change = ownedTomlEntry([...first.table, ...first.key], tools)
        ?? (!first.table.length && first.key.length === 1 ? ownedTopLevelKey(first.key[0]!, text, tools) : undefined);
      if (change) { changes.push(change); continue; }
    }
    output += text;
  }
  return { text: output, changes };
}

export function editContent(kind: FileKind, host: HostId, input: string, tools: readonly ToolId[]): EditResult {
  if (kind === 'instructions') return editInstructions(input, tools);
  if (kind === 'toml') return tomlEdit(input, tools);
  return jsonEdit(input, host, tools, kind === 'jsonc');
}
