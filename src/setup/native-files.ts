/** Internal native upgrade integrity checks shared by host-specific adapters. */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { sha256 } from '../adapters/operations.js';

export type Hashes = Record<string, string>;
export function equal(a: Hashes, b: Readonly<Hashes>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([p, hash]) => b[p] === hash);
}
export async function tree(root: string): Promise<Hashes> {
  if (await realpath(root) !== resolve(root)) throw new Error('symlink in plugin path');
  const hashes: Hashes = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir);
    if (!entries.length) throw new Error(`unrecognized empty plugin directory: ${dir}`);
    for (const name of entries.sort()) {
      const path = join(dir, name); const relative = prefix + name; const stat = await lstat(path);
      if (stat.isDirectory()) await walk(path, relative + '/');
      else if (stat.isFile()) hashes[relative] = sha256(await readFile(path));
      else throw new Error(`non-regular plugin entry: ${path}`);
    }
  }
  await walk(root, ''); return hashes;
}
export function version(value: unknown): value is string { return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value); }
/** A missing cache is an empty tree; every other irregularity still throws. */
export async function treeOrEmpty(root: string): Promise<Hashes> {
  try { await lstat(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  return tree(root);
}
/**
 * A registered marketplace root Edu may re-register: the root setup recorded, or an installed
 * edu-agent package (a Node version manager moved the global package root). Anything else is custom.
 */
/**
 * Codex on Windows reports some local paths in extended form (`\\?\C:\...`) and others in plain
 * form. Only the drive-letter form is reduced to its plain path; UNC and device paths stay as they are.
 */
export function nativePath<T>(value: T): T | string {
  return typeof value === 'string' && /^\\\\\?\\[A-Za-z]:\\/.test(value) ? value.slice(4) : value;
}
export function eduOwnedRoot(registered: unknown, previousPackageRoot: string | undefined): registered is string {
  return typeof registered === 'string' && isAbsolute(registered) &&
    (registered === previousPackageRoot || /[\\/]node_modules[\\/]edu-agent$/.test(registered));
}
