import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';

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

function serialize(value: JsonRecord): string { return `${JSON.stringify(value, null, 2)}\n`; }

function isEduHook(value: unknown): boolean {
  return record(value) && (value.command === 'edu hook session-start' || value.command === 'edu hook session-end');
}

function isEduEntry(value: unknown): boolean {
  return record(value) && (value.edu === true || value.matcher === 'edu' || (
    Array.isArray(value.hooks) && value.hooks.some(isEduHook)
  ));
}

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
  const result = serialize(target);
  return JSON.stringify(parseJson(text)) === JSON.stringify(target) ? text : result;
}

export function unmergeJson(text: string, patch: JsonRecord): string {
  const target = parseJson(text);
  removePatch(target, patch);
  const result = serialize(target);
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

// ---- JSONC: edit in place with jsonc-parser so comments and layout survive. -------------------

const isJsonc = (path: string) => path.toLowerCase().endsWith('.jsonc');
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

function parseJsonc(text: string): JsonRecord {
  if (!text.trim()) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !record(value)) throw new Error('Expected a JSONC object');
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
  for (const { path, union } of leaves(patch)) {
    const current = at(before, path);
    if (union && Array.isArray(current)) {
      // Insert at the front: a trailing `// comment` stays on the user's own last entry.
      for (const item of union.filter(item => !current.some(existing => same(existing, item))).reverse()) {
        out = applyEdits(out, modify(out, [...path, 0], item, { ...FORMAT, isArrayInsertion: true }));
      }
    } else out = applyEdits(out, modify(out, path, at(after, path), FORMAT));
  }
  return out;
}

function unmergeJsonc(text: string, patch: JsonRecord): string {
  const before = parseJsonc(text);
  const after = parseJsonc(text);
  removePatch(after, patch);
  if (same(before, after)) return text;
  let out = text;
  for (const { path, union } of leaves(patch)) {
    const current = at(before, path);
    if (union && Array.isArray(current) && Array.isArray(at(after, path))) {
      const owned = current.map((item, index) => union.some(mine => same(mine, item)) ? index : -1).filter(index => index >= 0);
      for (const index of owned.reverse()) out = applyEdits(out, modify(out, [...path, index], undefined, FORMAT));
      continue;
    }
    // Remove the outermost ancestor that the unmerge deleted, or rewrite the surviving leaf.
    const cut = path.findIndex((_, i) => at(after, path.slice(0, i + 1)) === undefined);
    if (cut >= 0) { if (at(before, path.slice(0, cut + 1)) !== undefined) out = applyEdits(out, modify(out, path.slice(0, cut + 1), undefined, FORMAT)); }
    else out = applyEdits(out, modify(out, path, at(after, path), FORMAT));
  }
  return out;
}

/** JSON or JSONC by file extension. */
export function mergeJsonFile(path: string, text: string, patch: JsonRecord): string {
  return isJsonc(path) ? mergeJsonc(text, patch) : mergeJson(text, patch);
}
export function unmergeJsonFile(path: string, text: string, patch: JsonRecord): string {
  return isJsonc(path) ? unmergeJsonc(text, patch) : unmergeJson(text, patch);
}
export function parseJsonFile(path: string, text: string): unknown {
  return isJsonc(path) ? parseJsonc(text) : JSON.parse(text);
}

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
function splitTopLevel(body: string): { top: string; tables: string } {
  const lines = body.trim().split(/\r?\n/);
  const firstTable = lines.findIndex(line => /^\s*\[/.test(line));
  const cut = firstTable < 0 ? lines.length : firstTable;
  return { top: lines.slice(0, cut).join('\n').trim(), tables: lines.slice(cut).join('\n').trim() };
}

function removeTopSection(text: string): string {
  const span = tomlTopBounds(text);
  if (!span) return text;
  const [start, end] = span;
  return text.slice(0, start) + text.slice(text[end] === '\n' ? end + 1 : end);
}

export function mergeToml(text: string, body: string): string {
  const prior = unmergeToml(text);
  let { top, tables } = splitTopLevel(body);
  if (hasTopLevelTomlKey(prior, 'notify')) {
    top = top.split(/\r?\n/).filter(line => !/^\s*notify\s*=/.test(line)).join('\n').trim();
  }
  let result = removeTopSection(text);
  if (tables) {
    const section = `${TOML_START}\n${tables}\n${TOML_END}`;
    const span = tomlBounds(result);
    if (span) result = result.slice(0, span[0]) + section + result.slice(span[1]);
    else {
      if (/^\s*\[mcp_servers\.edu\]\s*$/m.test(result)) throw new Error('Unmanaged Edu MCP TOML section already exists');
      result = `${result}${result ? '\n' : ''}${section}\n`;
    }
  }
  if (top) result = `${TOML_TOP_START}\n${top}\n${TOML_TOP_END}\n${result}`;
  return result;
}

/** Checks only TOML keys before the first table header (the true top-level scope). */
export function hasTopLevelTomlKey(text: string, key: string): boolean {
  const unmanaged = unmergeToml(text);
  let topLevel = true;
  for (const line of unmanaged.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^\[\[?.*\]\]?$/.test(trimmed)) { topLevel = false; continue; }
    if (topLevel && new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`).test(trimmed)) return true;
  }
  return false;
}

export function unmergeToml(input: string): string {
  const text = removeTopSection(input);
  const span = tomlBounds(text);
  if (!span) return text;
  const [start, end] = span;
  if (end === text.length - 1 && text[end] === '\n') {
    const prefix = text.slice(0, start);
    return prefix.endsWith('\n') ? prefix.slice(0, -1) : prefix;
  }
  return text.slice(0, start) + text.slice(end);
}
