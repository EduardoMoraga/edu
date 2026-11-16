import { parse, stringify } from 'yaml';

export interface MarkdownDocument<T extends object = Record<string, unknown>> {
  meta: T;
  body: string;
}

/**
 * The one frontmatter splitter: every Markdown file Edu reads (notes, playbooks, proposals, agent
 * templates, dashboards, synced notes) goes through it. Strips a UTF-8 BOM (Windows PowerShell 5.1 writes
 * one) and normalizes CRLF. `yaml` is the text between the `---` fences, undefined when the source has no
 * frontmatter; `body` is everything after the closing fence, untrimmed (or the whole source).
 */
export function splitFrontmatter(source: string): { yaml?: string; body: string } {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized);
  return match ? { yaml: match[1]!, body: match[2]! } : { body: normalized };
}

/** The parsed frontmatter and trimmed body, or undefined when the source has none. YAML errors throw. */
export function parseFrontmatter<T extends object = Record<string, unknown>>(source: string): MarkdownDocument<T> | undefined {
  const { yaml, body } = splitFrontmatter(source);
  if (yaml === undefined) return undefined;
  return { meta: (parse(yaml) ?? {}) as T, body: body.trim() };
}

export function parseMarkdown<T extends object = Record<string, unknown>>(source: string): MarkdownDocument<T> {
  return parseFrontmatter<T>(source) ?? { meta: {} as T, body: splitFrontmatter(source).body.trimEnd() };
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
    const { yaml, body } = splitFrontmatter(source);
    if (yaml === undefined) throw new Error('Unparseable frontmatter');
    const meta: Record<string, unknown> = {};
    let lastKey: string | undefined;
    for (const line of yaml.split('\n')) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (pair) {
        lastKey = pair[1]!;
        meta[lastKey] = flatValue(pair[2]!.trim());
      } else if (lastKey && /^\s+\S/.test(line) && typeof meta[lastKey] === 'string') {
        meta[lastKey] = `${meta[lastKey] as string} ${line.trim()}`.trim();
      }
    }
    return { meta: meta as T, body: body.trim(), recovered: true };
  }
}

function flatValue(raw: string): unknown {
  if (/^\[.*\]$/.test(raw)) return raw.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return raw.replace(/^(['"])(.*)\1$/, '$2');
}
