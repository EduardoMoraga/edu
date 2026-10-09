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
