import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Autonomy } from '../core/contracts.js';
import { UNICODE_GLYPHS } from './glyphs.js';

const root = fileURLToPath(new URL('../../templates/', import.meta.url));
const read = (rel: string) => readFile(root + rel, 'utf8');

function frontmatter(text: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('missing frontmatter');
  return parse(m[1]!) as Record<string, unknown>;
}

const AUTONOMY: Autonomy[] = ['readonly', 'ask', 'auto', 'full'];

describe('templates/EDU.md', () => {
  it('keeps the injected core small and the whole contract bounded (≈ chars / 3.7)', async () => {
    const text = await read('EDU.md');
    // Only the core is injected at every session start; the extended part is read on demand.
    const core = /<!-- edu:core -->([\s\S]*?)<!-- \/edu:core -->/.exec(text)?.[1] ?? '';
    expect(Math.ceil(core.length / 3.7)).toBeLessThan(600);
    expect(Math.ceil(text.length / 3.7)).toBeLessThan(2000);
  });
  it('has a short, delimited core section with the name placeholder', async () => {
    const text = await read('EDU.md');
    const core = /<!-- edu:core -->([\s\S]*?)<!-- \/edu:core -->/.exec(text)?.[1] ?? '';
    expect(core).toContain('{{name}}');
    expect(Math.ceil(core.length / 3.7)).toBeLessThan(400);
    for (const tool of ['edu_brief', 'edu_recall', 'edu_remember', 'edu_session_close']) expect(core).toContain(tool);
  });
  it('names every memory layer, transitive prefix and claim band', async () => {
    const text = await read('EDU.md');
    for (const word of ['canonical', 'episodic', 'transitive', 'D-', 'H-', 'C-', 'L-', 'verified', 'inferred', 'hypothesis', 'edu_read']) {
      expect(text).toContain(word);
    }
  });
});

describe('templates/agents', () => {
  for (const role of ['lead', 'explorer', 'builder', 'reviewer'] as const) {
    it(`${role}.md frontmatter matches RoleSpec`, async () => {
      const fm = frontmatter(await read(`agents/${role}.md`));
      expect(fm.id).toBe(role);
      expect(typeof fm.title).toBe('string');
      expect(fm.icon).toBe(UNICODE_GLYPHS.roles[role]);
      expect(typeof fm.mission).toBe('string');
      expect(AUTONOMY).toContain(fm.autonomy);
    });
  }
  it('keeps explorer and reviewer read-only', async () => {
    for (const role of ['explorer', 'reviewer']) {
      expect(frontmatter(await read(`agents/${role}.md`)).autonomy).toBe('readonly');
    }
  });
});

describe('templates/skills', () => {
  for (const name of ['edu-brain', 'edu-reflect']) {
    it(`${name}/SKILL.md has name and description`, async () => {
      const fm = frontmatter(await read(`skills/${name}/SKILL.md`));
      expect(fm.name).toBe(name);
      expect(typeof fm.description).toBe('string');
      expect((fm.description as string).length).toBeGreaterThan(40);
    });
  }
});
