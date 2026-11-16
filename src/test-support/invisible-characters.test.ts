import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Trojan Source (CVE-2021-42574) class: bidi controls reorder what a reviewer sees, and zero-width or
 * separator characters hide text. In source, templates and scripts they must be written as `\u` escapes.
 */
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
const ROOT = join(import.meta.dirname, '..', '..');
const DIRS = ['src', 'templates', 'scripts'];
const SKIP = new Set(['node_modules', '.git']);

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  const nested = await Promise.all(entries.filter(entry => !SKIP.has(entry.name)).map(entry => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

/** `file:line:column U+XXXX` for every raw invisible character in a text file. */
function invisibleCharacters(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, i) => [...line.matchAll(INVISIBLE)]
    .map(match => `${file}:${i + 1}:${match.index + 1} U+${match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`));
}

describe('invisible characters', () => {
  it('reports each raw bidi, zero-width or separator character with its place', () => {
    expect(invisibleCharacters('a.ts', 'ok\nconst s = "x\u202Ey";\n\uFEFFz\u200B')).toEqual(['a.ts:2:13 U+202E', 'a.ts:3:1 U+FEFF', 'a.ts:3:3 U+200B']);
    expect(invisibleCharacters('a.ts', 'const s = "x\\u202Ey"; // written as an escape')).toEqual([]);
  });

  it('appear only as escapes in src/, templates/ and scripts/', async () => {
    const files = (await Promise.all(DIRS.map(filesUnder))).flat();
    expect(files.length).toBeGreaterThan(100);
    const found: string[] = [];
    for (const file of files) {
      const bytes = await readFile(join(ROOT, file));
      if (bytes.includes(0)) continue; // binary
      found.push(...invisibleCharacters(relative(ROOT, join(ROOT, file)).split(sep).join('/'), bytes.toString('utf8')));
    }
    expect(found).toEqual([]);
  });
});
