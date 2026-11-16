import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseMarkdown, parseMarkdownLenient, serializeMarkdown, splitFrontmatter } from './frontmatter.js';

describe('markdown frontmatter', () => {
  it('round-trips yaml metadata and markdown body stably', () => {
    const source = '---\ntitle: A note\ntags:\n  - Edu\n---\n\nBody text.\n';
    const parsed = parseMarkdown(source);
    expect(parsed.meta).toEqual({ title: 'A note', tags: ['Edu'] });
    expect(parsed.body).toBe('Body text.');
    expect(serializeMarkdown(parsed.meta, parsed.body)).toBe(source);
  });
  it('accepts markdown without frontmatter', () => {
    expect(parseMarkdown('# Plain').body).toBe('# Plain');
  });
});

describe('parseMarkdownLenient', () => {
  it('recovers flat metadata when a plain scalar contains colon-space', () => {
    const doc = parseMarkdownLenient('---\ntitulo: Regla\nresumen: Hay que validar: siempre\ntags: [a, b]\n---\n\nBody');
    expect(doc.recovered).toBe(true);
    expect(doc.meta).toMatchObject({ titulo: 'Regla', resumen: 'Hay que validar: siempre', tags: ['a', 'b'] });
    expect(doc.body).toBe('Body');
  });
  it('uses strict YAML when it parses', () => {
    expect(parseMarkdownLenient('---\na: 1\n---\nx').recovered).toBe(false);
  });
});

describe('UTF-8 BOM', () => {
  it('reads frontmatter written by Windows PowerShell 5.1 with a leading BOM', () => {
    const doc = parseMarkdown<{ title: string }>('\uFEFF---\r\ntitle: Nada se publica\r\n---\r\n\r\nBody.\r\n');
    expect(doc.meta.title).toBe('Nada se publica');
    expect(doc.body).toBe('Body.');
    expect(parseMarkdownLenient<{ title: string }>('\uFEFF---\ntitle: X\n---\nB\n').meta.title).toBe('X');
  });
});

describe('the one frontmatter splitter', () => {
  it('splits BOM and CRLF sources into the YAML text and the raw body', () => {
    expect(splitFrontmatter('\uFEFF---\r\na: 1\r\n---\r\n\r\nbody\r\n')).toEqual({ yaml: 'a: 1', body: '\nbody\n' });
    expect(splitFrontmatter('---\na: 1\n---')).toEqual({ yaml: 'a: 1', body: '' });
    expect(splitFrontmatter('no fence\r\n---\n')).toEqual({ body: 'no fence\n---\n' });
    expect(splitFrontmatter('---\na: 1\n----\nx')).toEqual({ body: '---\na: 1\n----\nx' });
  });

  it('parses frontmatter only when present, and lets YAML errors through', () => {
    expect(parseFrontmatter('---\r\nname: x\r\n---\r\n  body  \r\n')).toEqual({ meta: { name: 'x' }, body: 'body' });
    expect(parseFrontmatter('# just markdown')).toBeUndefined();
    expect(parseFrontmatter('---\n---\n')).toBeUndefined();
    expect(() => parseFrontmatter('---\na: [\n---\n')).toThrow();
  });
});

describe('one parser', () => {
  it('is the only place that recognizes frontmatter fences (skills/bundle.ts excepted: Node type stripping loads it)', async () => {
    const src = join(import.meta.dirname, '..');
    const files = (await readdir(src, { recursive: true })).filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
    const fences: string[] = [];
    for (const name of files) {
      const text = await readFile(join(src, name), 'utf8');
      // A regex anchored on the opening fence (optionally after a BOM), or a split or search for a bare `---` line.
      if (/\/\^(?:\\uFEFF\??)?---|indexOf\('---'/.test(text)) fences.push(relative(src, join(src, name)).split(sep).join('/'));
    }
    expect(fences.sort()).toEqual(['brain/frontmatter.ts', 'skills/bundle.ts']);
  });
});
