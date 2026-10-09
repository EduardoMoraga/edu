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

function tomlBounds(text: string): [number, number] | undefined {
  const start = text.indexOf(TOML_START);
  const end = text.indexOf(TOML_END);
  if ((start < 0) !== (end < 0)) throw new Error('Malformed Edu TOML section');
  if (start < 0) return undefined;
  if (end < start || text.indexOf(TOML_START, start + TOML_START.length) >= 0 || text.indexOf(TOML_END, end + TOML_END.length) >= 0) throw new Error('Malformed Edu TOML section');
  return [start, end + TOML_END.length];
}

export function mergeToml(text: string, body: string): string {
  const section = `${TOML_START}\n[mcp_servers.edu]\n${body.trim()}\n${TOML_END}`;
  const span = tomlBounds(text);
  if (span) return text.slice(0, span[0]) + section + text.slice(span[1]);
  if (/^\s*\[mcp_servers\.edu\]\s*$/m.test(text)) throw new Error('Unmanaged Edu MCP TOML section already exists');
  const separator = !text ? '' : '\n';
  return `${text}${separator}${section}\n`;
}

export function unmergeToml(text: string): string {
  const span = tomlBounds(text);
  if (!span) return text;
  const [start, end] = span;
  if (end === text.length - 1 && text[end] === '\n') {
    const prefix = text.slice(0, start);
    return prefix.endsWith('\n') ? prefix.slice(0, -1) : prefix;
  }
  return text.slice(0, start) + text.slice(end);
}
