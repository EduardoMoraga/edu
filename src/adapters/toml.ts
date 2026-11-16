/**
 * The one TOML scanner Edu uses on host configs (Codex `config.toml`): the installer's merge and drift
 * checks, `edu detach` and `edu doctor` all read tables and keys through it. It is a line scanner, not a
 * parser: it knows table headers (`[a."b"]`, `[[a.'b']]`), dotted keys in every quoting, and skips the
 * inside of multi-line strings, arrays and inline tables, which is what finding and editing tables needs.
 */

/** `a."b.c".'d'` → ['a', 'b.c', 'd']; undefined for anything that is not a plain TOML key. */
export function tomlKeyParts(key: string): string[] | undefined {
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

export interface TomlLine {
  /** The line as written, without its line ending. */
  text: string;
  /** The line ending after it: '\n', '\r\n', or '' on the last line. */
  eol: string;
  /** The table the line sits in ([] before the first header). A header line carries its own path. */
  table: string[];
  /** On a table header: its path (undefined when it is not a plain key) and whether it is `[[…]]`. */
  header?: { path: string[] | undefined; array: boolean };
  /** On the line that starts a key/value statement: the key path, relative to `table`. */
  key?: string[];
  /** The value text after `=` on that line. */
  value?: string;
  /** The line continues a multi-line string, array or inline table that an earlier line began. */
  continuation: boolean;
}

/** Keys under a header that is not a plain key never match a real table. */
const UNKNOWN_TABLE = '\0';

/** Every line of a TOML document with the table it belongs to and what it declares. */
export function scanTomlLines(text: string): TomlLine[] {
  const pieces = text.split(/(\r?\n)/);
  const lines: TomlLine[] = [];
  let table: string[] = [];
  let multiline: string | undefined;
  let depth = 0;
  for (let i = 0; i < pieces.length; i += 2) {
    const raw = pieces[i]!;
    const base = { text: raw, eol: pieces[i + 1] ?? '' };
    const line = raw.trim();
    if (multiline) {
      if (line.includes(multiline)) multiline = undefined;
      lines.push({ ...base, table, continuation: true });
      continue;
    }
    if (depth > 0) {
      depth += openBrackets(line);
      lines.push({ ...base, table, continuation: true });
      continue;
    }
    const header = !line || line.startsWith('#') ? null : /^\[(\[?)\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      const path = tomlKeyParts(header[2]!);
      table = path ?? [UNKNOWN_TABLE];
      lines.push({ ...base, table, header: { path, array: header[1] === '[' }, continuation: false });
      continue;
    }
    const end = !line || line.startsWith('#') ? -1 : keyEnd(line);
    const key = end > 0 ? tomlKeyParts(line.slice(0, end)) : undefined;
    if (end <= 0) { lines.push({ ...base, table, continuation: false }); continue; }
    const value = line.slice(end + 1).trim();
    lines.push({ ...base, table, ...(key ? { key } : {}), value, continuation: false });
    for (const quote of ['"""', "'''"]) {
      if (value.startsWith(quote) && value.split(quote).length === 2) multiline = quote;
    }
    if (!multiline) depth = Math.max(0, openBrackets(value));
  }
  return lines;
}

export interface TomlKey { path: string[]; header: boolean; table: string[] }

/**
 * Every key a TOML document defines, as full paths: table headers (`[a."b"]`, `[[a.b]]`), and keys
 * joined to their table (`edu = {…}` under `[mcp_servers]`, top-level `mcp_servers.edu.command = …`).
 */
export function tomlKeys(text: string): TomlKey[] {
  return scanTomlLines(text).flatMap((line): TomlKey[] => {
    if (line.header) return line.header.path ? [{ path: line.header.path, header: true, table: [] }] : [];
    return line.key ? [{ path: [...line.table, ...line.key], header: false, table: line.table }] : [];
  });
}

/** Whether `path` (a list of key parts) starts with `prefix`. */
export const tomlPathStarts = (path: readonly string[], prefix: readonly string[]): boolean =>
  path.length >= prefix.length && prefix.every((part, i) => path[i] === part);

/** Whether the TOML defines `path` or anything inside it, in any of TOML's spellings. */
export function tomlDefines(text: string, path: string[]): boolean {
  return tomlKeys(text).some(key => tomlPathStarts(key.path, path));
}

/**
 * Tables named `[root.<name>]` (or `root.<name> = {…}`), each with whether it is enabled: `enabled = false`
 * on the table itself turns it off. Codex keeps plugins this way.
 */
export function tomlEnabledTables(text: string, root: string): Map<string, boolean> {
  const states = new Map<string, boolean>();
  for (const line of scanTomlLines(text)) {
    const path = line.header?.path ?? (line.key ? [...line.table, ...line.key] : undefined);
    if (line.continuation || !path || path[0] !== root || !path[1]) continue;
    const name = path[1];
    if (!states.has(name)) states.set(name, true);
    const off = path.length === 3 && path[2] === 'enabled' ? /^false\b/.test(line.value ?? '')
      : path.length === 2 && !line.header && /\benabled\s*=\s*false\b/.test(line.value ?? '');
    if (off) states.set(name, false);
  }
  return states;
}

/** The body without its `[path]` tables and their subtables (Edu's TOML body is generated, one header per table). */
export function withoutTomlTable(body: string, path: string[]): string {
  let skipping = false;
  return scanTomlLines(body).filter(line => {
    if (line.header) skipping = !!line.header.path && tomlPathStarts(line.header.path, path);
    return !skipping;
  }).map(line => line.text).join('\n').trim();
}
