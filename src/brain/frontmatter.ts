import { parse, stringify } from 'yaml';

export interface MarkdownDocument<T extends object = Record<string, unknown>> {
  meta: T;
  body: string;
}

export function parseMarkdown<T extends object = Record<string, unknown>>(source: string): MarkdownDocument<T> {
  const normalized = source.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) return { meta: {} as T, body: normalized.trimEnd() };
  const meta = (parse(match[1] ?? '') ?? {}) as T;
  return { meta, body: (match[2] ?? '').trim() };
}

export function serializeMarkdown(meta: Record<string, unknown>, body: string): string {
  const yaml = stringify(meta, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

/**
 * Tolerant variant for importing hand-written vaults: when strict YAML fails (e.g. an
 * unquoted `key: text: more text`), falls back to flat `key: value` lines. Inline
 * `[a, b]` lists become arrays; indented continuation lines join the previous value.
 */
export function parseMarkdownLenient<T extends object = Record<string, unknown>>(source: string): MarkdownDocument<T> & { recovered: boolean } {
  try {
    return { ...parseMarkdown<T>(source), recovered: false };
  } catch {
    const normalized = source.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
    if (!match) throw new Error('Unparseable frontmatter');
    const meta: Record<string, unknown> = {};
    let lastKey: string | undefined;
    for (const line of (match[1] ?? '').split('\n')) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (pair) {
        lastKey = pair[1]!;
        meta[lastKey] = flatValue(pair[2]!.trim());
      } else if (lastKey && /^\s+\S/.test(line) && typeof meta[lastKey] === 'string') {
        meta[lastKey] = `${meta[lastKey] as string} ${line.trim()}`.trim();
      }
    }
    return { meta: meta as T, body: (match[2] ?? '').trim(), recovered: true };
  }
}

function flatValue(raw: string): unknown {
  if (/^\[.*\]$/.test(raw)) return raw.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return raw.replace(/^(['"])(.*)\1$/, '$2');
}
