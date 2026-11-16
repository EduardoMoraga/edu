import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { eolOf, sectionDigest } from './blocks.js';

type JsonRecord = Record<string, unknown>;

/**
 * `{ key: { $union: [...] } }` in a patch adds items to an array Edu shares with the user (OpenCode
 * `tui.json` `plugin`), keeping every other entry and never duplicating; unmerge removes only them.
 */
export const UNION = '$union';
function unionItems(value: unknown): unknown[] | undefined {
  return record(value) && Object.keys(value).length === 1 && Array.isArray(value[UNION]) ? value[UNION] as unknown[] : undefined;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(text: string): JsonRecord {
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!record(parsed)) throw new Error('Expected a JSON object');
  return parsed;
}

/** The layout a JSON file already has, so Edu's edits keep the user's indentation and line endings. */
interface JsonStyle { indent: string; eol: '\r\n' | '\n'; finalNewline: boolean }
function jsonStyle(text: string): JsonStyle {
  if (!text.trim()) return { indent: '  ', eol: '\n', finalNewline: true };
  const indented = /\n([ \t]+)\S/.exec(text);
  const indent = indented ? (indented[1]!.startsWith('\t') ? '\t' : ' '.repeat(indented[1]!.length)) : text.trim().includes('\n') ? '  ' : '';
  return { indent, eol: eolOf(text), finalNewline: /\n$/.test(text) };
}

/** `value` serialized in the layout `original` already has (indentation, line endings, final newline). */
export function serializeLike(original: string, value: JsonRecord): string { return serialize(value, jsonStyle(original)); }
/** jsonc-parser formatting options that match the layout `text` already has. */
export function jsoncFormatFor(text: string) { return formatFor(text); }

function serialize(value: JsonRecord, style: JsonStyle): string {
  return `${JSON.stringify(value, null, style.indent).replace(/\n/g, style.eol)}${style.finalNewline ? style.eol : ''}`;
}

function isEduHook(value: unknown): boolean {
  return record(value) && (value.command === 'edu hook session-start' || value.command === 'edu hook session-end');
}

function isEduEntry(value: unknown): boolean {
  return record(value) && (value.edu === true || value.matcher === 'edu' || (
    Array.isArray(value.hooks) && value.hooks.some(isEduHook)
  ));
}

const isEduEntryArray = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every(isEduEntry);

function withoutEduEntry(value: unknown): unknown | undefined {
  if (!record(value)) return value;
  if (Array.isArray(value.hooks)) {
    const hooks = value.hooks.filter(hook => !isEduHook(hook));
    if (hooks.length !== value.hooks.length) return hooks.length ? { ...value, hooks } : undefined;
  }
  return isEduEntry(value) ? undefined : value;
}

function applyPatch(target: JsonRecord, patch: JsonRecord): void {
  for (const [key, value] of Object.entries(patch)) {
    const added = unionItems(value);
    if (added) {
      const prior = Array.isArray(target[key]) ? target[key] as unknown[] : [];
      target[key] = [...prior, ...added.filter(item => !prior.some(existing => same(existing, item)))];
    } else if (Array.isArray(value)) {
      if (value.every(isEduEntry)) {
        const prior = Array.isArray(target[key]) ? target[key] as unknown[] : [];
        target[key] = [...prior.map(withoutEduEntry).filter(entry => entry !== undefined), ...value];
      } else {
        target[key] = value;
      }
    } else if (record(value)) {
      const prior = record(target[key]) ? target[key] as JsonRecord : {};
      applyPatch(prior, value);
      target[key] = prior;
    } else {
      target[key] = value;
    }
  }
}

function removePatch(target: JsonRecord, patch: JsonRecord): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target)) continue;
    const removed = unionItems(value);
    if (removed) {
      if (!Array.isArray(target[key])) continue;
      const remaining = (target[key] as unknown[]).filter(item => !removed.some(owned => same(owned, item)));
      if (remaining.length) target[key] = remaining;
      else delete target[key];
    } else if (Array.isArray(value) && Array.isArray(target[key])) {
      if (value.every(isEduEntry)) {
        const remaining = (target[key] as unknown[]).map(withoutEduEntry).filter(entry => entry !== undefined);
        if (remaining.length) target[key] = remaining;
        else delete target[key];
      } else {
        delete target[key];
      }
    } else if (record(value) && record(target[key])) {
      removePatch(target[key] as JsonRecord, value);
      if (!Object.keys(target[key] as JsonRecord).length) delete target[key];
    } else {
      delete target[key];
    }
  }
}

export function mergeJson(text: string, patch: JsonRecord): string {
  const target = parseJson(text);
  applyPatch(target, patch);
  const result = serialize(target, jsonStyle(text));
  return JSON.stringify(parseJson(text)) === JSON.stringify(target) ? text : result;
}

export function unmergeJson(text: string, patch: JsonRecord): string {
  const target = parseJson(text);
  removePatch(target, patch);
  const result = serialize(target, jsonStyle(text));
  return JSON.stringify(parseJson(text)) === JSON.stringify(target) ? text : result;
}

/** Whether `target` still holds everything `patch` wrote (union items only need to be present). */
export function containsPatch(target: unknown, patch: unknown): boolean {
  const union = unionItems(patch);
  if (union) return Array.isArray(target) && union.every(item => target.some(candidate => same(candidate, item)));
  if (Array.isArray(patch)) {
    return Array.isArray(target) && patch.every(item => target.some(candidate => same(candidate, item)));
  }
  if (patch && typeof patch === 'object') {
    if (!target || typeof target !== 'object') return false;
    return Object.entries(patch as JsonRecord).every(([key, value]) => containsPatch((target as JsonRecord)[key], value));
  }
  return same(target, patch);
}

// ---- Values the user owns: Edu never overwrites them. ----------------------------------------

/**
 * The objects a patch owns as a whole inside a file it shares with the user: `statusLine`,
 * `mcpServers.edu`, `agent.<name>`. Arrays of Edu entries (hooks) and `$union` lists already keep
 * the user's items, so they are not units.
 */
export function patchUnits(patch: JsonRecord, prefix: string[] = []): string[][] {
  const units: string[][] = [];
  const leaves = Object.entries(patch).filter(([, value]) => !record(value) && !isEduEntryArray(value));
  if (leaves.length) units.push(...(prefix.length ? [prefix] : leaves.map(([key]) => [key])));
  for (const [key, value] of Object.entries(patch)) if (record(value) && !unionItems(value)) units.push(...patchUnits(value, [...prefix, key]));
  return units;
}

function without(patch: JsonRecord, path: string[]): JsonRecord {
  const [key, ...rest] = path;
  if (key === undefined || !(key in patch)) return patch;
  const copy = { ...patch };
  if (!rest.length || !record(copy[key])) delete copy[key];
  else {
    const inner = without(copy[key] as JsonRecord, rest);
    if (Object.keys(inner).length) copy[key] = inner; else delete copy[key];
  }
  return copy;
}

export interface ResolvedPatch { patch: JsonRecord; kept: string[] }

/**
 * The part of `patch` Edu may write into `text`. A unit that already holds a value Edu did not write
 * (`owned` is what an earlier Edu install recorded there) stays the user's: it is dropped from the
 * patch, so install never changes it and uninstall never removes it. Units holding a different value
 * are reported in `kept`.
 */
export function resolveJsonPatch(path: string, text: string, patch: JsonRecord, owned?: JsonRecord): ResolvedPatch {
  const target = parseJsonFile(path, text);
  let result = patch;
  const kept: string[] = [];
  for (const unit of patchUnits(patch)) {
    const current = at(target, unit);
    if (current === undefined) continue;
    const mine = owned ? at(owned, unit) : undefined;
    if (mine !== undefined && containsPatch(current, mine)) continue;
    result = without(result, unit);
    if (!containsPatch(current, at(patch, unit))) kept.push(unit.join('.'));
  }
  return { patch: result, kept };
}

// ---- JSONC: edit in place with jsonc-parser so comments and layout survive. -------------------

/** `.jsonc`, plus OpenCode's `opencode.json`, which OpenCode itself parses as JSONC (comments, trailing commas). */
const isJsonc = (path: string) => { const lower = path.toLowerCase().replace(/\\/g, '/'); return lower.endsWith('.jsonc') || lower.endsWith('/opencode.json'); };

function formatFor(text: string) {
  const style = jsonStyle(text);
  return { formattingOptions: { insertSpaces: style.indent !== '\t', tabSize: style.indent === '\t' ? 1 : style.indent.length || 2, eol: style.eol } };
}

function parseJsonc(text: string): JsonRecord {
  if (!text.trim()) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}`);
  if (!record(value)) throw new Error('Expected a JSON object');
  return value;
}

function leaves(patch: JsonRecord, prefix: string[] = []): Array<{ path: string[]; union?: unknown[] }> {
  return Object.entries(patch).flatMap(([key, value]) => {
    const union = unionItems(value);
    if (union) return [{ path: [...prefix, key], union }];
    return record(value) ? leaves(value, [...prefix, key]) : [{ path: [...prefix, key] }];
  });
}

function at(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (record(node) ? node[key] : undefined), value);
}

function mergeJsonc(text: string, patch: JsonRecord): string {
  const before = parseJsonc(text);
  const after = parseJsonc(text);
  applyPatch(after, patch);
  if (same(before, after)) return text;
  let out = text.trim() ? text : '{}\n';
  const format = formatFor(text);
  for (const { path, union } of leaves(patch)) {
    const current = at(before, path);
    if (union && Array.isArray(current)) {
      // Insert at the front: a trailing `// comment` stays on the user's own last entry.
      for (const item of union.filter(item => !current.some(existing => same(existing, item))).reverse()) {
        out = applyEdits(out, modify(out, [...path, 0], item, { ...format, isArrayInsertion: true }));
      }
    } else out = applyEdits(out, modify(out, path, at(after, path), format));
  }
  return out;
}

function unmergeJsonc(text: string, patch: JsonRecord): string {
  const before = parseJsonc(text);
  const after = parseJsonc(text);
  removePatch(after, patch);
  if (same(before, after)) return text;
  let out = text;
  const format = formatFor(text);
  for (const { path, union } of leaves(patch)) {
    const current = at(before, path);
    if (union && Array.isArray(current) && Array.isArray(at(after, path))) {
      const owned = current.map((item, index) => union.some(mine => same(mine, item)) ? index : -1).filter(index => index >= 0);
      for (const index of owned.reverse()) out = applyEdits(out, modify(out, [...path, index], undefined, format));
      continue;
    }
    // Remove the outermost ancestor that the unmerge deleted, or rewrite the surviving leaf.
    const cut = path.findIndex((_, i) => at(after, path.slice(0, i + 1)) === undefined);
    if (cut >= 0) { if (at(before, path.slice(0, cut + 1)) !== undefined) out = applyEdits(out, modify(out, path.slice(0, cut + 1), undefined, format)); }
    else out = applyEdits(out, modify(out, path, at(after, path), format));
  }
  return out;
}

/** Every parse failure names the file and what it must contain. */
function named<T>(path: string, run: () => T): T {
  try { return run(); }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const expected = isJsonc(path) ? 'a JSON object (comments allowed)' : 'a plain JSON object, without comments or trailing commas';
    throw new Error(`Cannot parse ${path}: ${reason}. It must hold ${expected}; fix it and run again.`);
  }
}

/** JSON or JSONC by file extension. */
export function mergeJsonFile(path: string, text: string, patch: JsonRecord): string {
  return named(path, () => isJsonc(path) ? mergeJsonc(text, patch) : mergeJson(text, patch));
}
export function unmergeJsonFile(path: string, text: string, patch: JsonRecord): string {
  return named(path, () => isJsonc(path) ? unmergeJsonc(text, patch) : unmergeJson(text, patch));
}
export function parseJsonFile(path: string, text: string): unknown {
  return named(path, () => isJsonc(path) ? parseJsonc(text) : parseJson(text));
}

// ---- TOML (Codex config.toml): Edu's own delimited sections. ---------------------------------

const TOML_START = '# edu:start';
const TOML_END = '# edu:end';
// Top-level keys (e.g. Codex `notify`) must precede every table header, otherwise TOML scopes
// them to the preceding table. They live in their own managed block at the top of the file.
const TOML_TOP_START = '# edu:top:start';
const TOML_TOP_END = '# edu:top:end';

function markerBounds(text: string, startMarker: string, endMarker: string): [number, number] | undefined {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if ((start < 0) !== (end < 0)) throw new Error('Malformed Edu TOML section');
  if (start < 0) return undefined;
  if (end < start || text.indexOf(startMarker, start + startMarker.length) >= 0 || text.indexOf(endMarker, end + endMarker.length) >= 0) throw new Error('Malformed Edu TOML section');
  return [start, end + endMarker.length];
}

const tomlBounds = (text: string) => markerBounds(text, TOML_START, TOML_END);
const tomlTopBounds = (text: string) => markerBounds(text, TOML_TOP_START, TOML_TOP_END);

/** Splits a TOML body into the keys before the first table header and the rest. */
function splitTopLevel(body: string, eol: string): { top: string; tables: string } {
  const lines = body.trim().split(/\r?\n/);
  const firstTable = lines.findIndex(line => /^\s*\[/.test(line));
  const cut = firstTable < 0 ? lines.length : firstTable;
  return { top: lines.slice(0, cut).join(eol).trim(), tables: lines.slice(cut).join(eol).trim() };
}

/** The line ending that follows `end`, if any. */
const eolAt = (text: string, end: number) => text.startsWith('\r\n', end) ? '\r\n' : text.startsWith('\n', end) ? '\n' : '';

function removeTopSection(text: string): string {
  const span = tomlTopBounds(text);
  if (!span) return text;
  const [start, end] = span;
  return text.slice(0, start) + text.slice(end + eolAt(text, end).length);
}

/** Edu's own TOML text (both sections, markers included), for the drift check. */
export function tomlSectionsDigest(text: string): string | undefined {
  const top = tomlTopBounds(text);
  const main = tomlBounds(text);
  if (!top && !main) return undefined;
  return sectionDigest([top ? text.slice(...top) : '', main ? text.slice(...main) : ''].join('\n'));
}

export const EDU_MCP_TOML_PATH = ['mcp_servers', 'edu'];

export function mergeToml(text: string, body: string): string {
  const eol = eolOf(text);
  const user = unmergeToml(text);
  let { top, tables } = splitTopLevel(body, eol);
  if (hasTopLevelTomlKey(user, 'notify')) {
    top = top.split(/\r?\n/).filter(line => !/^\s*notify\s*=/.test(line)).join(eol).trim();
  }
  let result = removeTopSection(text);
  const span = tomlBounds(result);
  if (tables) {
    const section = `${TOML_START}${eol}${tables}${eol}${TOML_END}`;
    if (span) result = result.slice(0, span[0]) + section + result.slice(span[1]);
    else {
      if (tomlDefines(result, EDU_MCP_TOML_PATH) && tomlDefines(tables, EDU_MCP_TOML_PATH)) throw new Error('Unmanaged Edu MCP TOML section already exists');
      result = `${result}${result ? eol : ''}${section}${eol}`;
    }
  } else if (span) result = unmergeToml(result);
  if (top) result = `${TOML_TOP_START}${eol}${top}${eol}${TOML_TOP_END}${eol}${result}`;
  return result;
}

interface TomlKey { path: string[]; header: boolean; table: string[] }

/** `a."b.c".'d'` → ['a', 'b.c', 'd']; undefined for anything that is not a plain TOML key. */
function tomlKeyParts(key: string): string[] | undefined {
  const parts: string[] = [];
  let rest = key.trim();
  while (rest) {
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(rest) ?? /^'([^']*)'/.exec(rest) ?? /^([A-Za-z0-9_-]+)/.exec(rest);
    if (!match) return undefined;
    parts.push(match[0].startsWith('"') ? match[1]!.replace(/\\(.)/g, '$1') : match[1]!);
    rest = rest.slice(match[0].length).trimStart();
    if (!rest) break;
    if (!rest.startsWith('.')) return undefined;
    rest = rest.slice(1).trimStart();
  }
  return parts.length ? parts : undefined;
}

/** Index of the `=` that ends a key, outside quotes; -1 when the line is not a key/value pair. */
function keyEnd(line: string): number {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) { if (char === '\\' && quote === '"') i++; else if (char === quote) quote = undefined; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '=') return i;
    else if (char === '#' || char === '[' || char === '{') return -1;
  }
  return -1;
}

/** Bracket depth a TOML value leaves open (multi-line arrays and inline tables), strings skipped. */
function openBrackets(value: string): number {
  let depth = 0; let quote: string | undefined;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (quote) { if (char === '\\' && quote === '"') i++; else if (char === quote) quote = undefined; continue; }
    if (char === '#') break;
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') depth--;
  }
  return depth;
}

/**
 * Every key a TOML document defines, as full paths: table headers (`[a."b"]`, `[[a.b]]`), and keys
 * joined to their table (`edu = {…}` under `[mcp_servers]`, top-level `mcp_servers.edu.command = …`).
 * The single TOML key scanner the installer and doctor share; multi-line strings and arrays are skipped.
 */
export function tomlKeys(text: string): TomlKey[] {
  const keys: TomlKey[] = [];
  let table: string[] = [];
  let multiline: string | undefined;
  let depth = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (multiline) { if (line.includes(multiline)) multiline = undefined; continue; }
    if (depth > 0) { depth += openBrackets(line); continue; }
    if (!line || line.startsWith('#')) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      const parts = tomlKeyParts(header[1]!);
      table = parts ?? ['\0'];
      if (parts) keys.push({ path: parts, header: true, table: [] });
      continue;
    }
    const end = keyEnd(line);
    if (end <= 0) continue;
    const parts = tomlKeyParts(line.slice(0, end));
    if (parts) keys.push({ path: [...table, ...parts], header: false, table });
    const value = line.slice(end + 1).trim();
    for (const quote of ['"""', "'''"]) {
      if (value.startsWith(quote) && value.split(quote).length === 2) multiline = quote;
    }
    if (!multiline) depth = Math.max(0, openBrackets(value));
  }
  return keys;
}

/** Whether the TOML defines `path` or anything inside it, in any of TOML's spellings. */
export function tomlDefines(text: string, path: string[]): boolean {
  return tomlKeys(text).some(key => key.path.length >= path.length && path.every((part, i) => key.path[i] === part));
}

/** The body without its `[path]` tables (Edu's TOML body is generated, one header per table). */
export function withoutTomlTable(body: string, path: string[]): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of body.split(/\r?\n/)) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(line);
    if (header) {
      const parts = tomlKeyParts(header[1]!);
      skipping = !!parts && parts.length >= path.length && path.every((part, i) => parts[i] === part);
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n').trim();
}

/** Checks only TOML keys before the first table header (the true top-level scope). */
export function hasTopLevelTomlKey(text: string, key: string): boolean {
  return tomlKeys(unmergeToml(text)).some(entry => !entry.header && !entry.table.length && entry.path.length === 1 && entry.path[0] === key);
}

export function unmergeToml(input: string): string {
  const text = removeTopSection(input);
  const span = tomlBounds(text);
  if (!span) return text;
  const [start, end] = span;
  const eol = eolAt(text, end);
  if (eol && end + eol.length === text.length) {
    const prefix = text.slice(0, start);
    return prefix.endsWith(eol) ? prefix.slice(0, -eol.length) : prefix;
  }
  return text.slice(0, start) + text.slice(end);
}
