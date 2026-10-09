import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseMarkdownLenient, serializeMarkdown } from './frontmatter.js';

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
