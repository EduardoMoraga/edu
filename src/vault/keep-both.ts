import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { assertSafeTarget } from './safe-path.js';

/** `notes/a.md` → `notes/a.local-<host>.md`. */
export function localCopyName(path: string, host: string): string {
  const ext = extname(path);
  return `${ext ? path.slice(0, -ext.length) : path}.local-${host}${ext}`;
}

/** Exclusive keep-both write shared by join and sync; existing identical copies are reused. */
export async function keepBothCopy(
  root: string, path: string, suffix: string,
  nameFor: (path: string, suffix: string) => string,
  contentFor: (suffix: string) => Buffer,
): Promise<string> {
  for (let n = 1; n <= 100; n++) {
    const candidate = n === 1 ? suffix : `${suffix}-${n}`;
    const name = nameFor(path, candidate);
    const target = join(root, name);
    const content = contentFor(candidate);
    await assertSafeTarget(root, target);
    try {
      await writeFile(target, content, { flag: 'wx' });
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if ((await readFile(target).catch(() => undefined))?.equals(content)) return name;
    }
  }
  throw new Error(`no free name for a local copy of ${path}`);
}
