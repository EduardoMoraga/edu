import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeMarkdown } from './frontmatter.js';

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
