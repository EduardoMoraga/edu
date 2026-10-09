type JsonRecord = Record<string, unknown>;

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
    if (Array.isArray(value)) {
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
    if (Array.isArray(value) && Array.isArray(target[key])) {
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
