/** Internal native upgrade integrity checks shared by host-specific adapters. */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, posix, relative, win32 } from 'node:path';
import { sha256 } from '../adapters/operations.js';

export type Hashes = Record<string, string>;
export function equal(a: Hashes, b: Readonly<Hashes>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([p, hash]) => b[p] === hash);
}
/**
 * Whether `path` resolves where it says, below `anchor`: no link from the anchor down. Links above the
 * anchor (macOS /var → /private/var, a symlinked HOME) are the user's layout and are fine.
 */
export async function resolvesInPlace(path: string, anchor: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if ((await lstat(path)).isSymbolicLink()) return false;
  return samePath(await realpath(path), join(await realpath(anchor), relative(anchor, path)), platform);
}

export async function tree(root: string, anchor = dirname(root)): Promise<Hashes> {
  if (!await resolvesInPlace(root, anchor)) throw new Error('symlink in plugin path');
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
export async function treeOrEmpty(root: string, anchor?: string): Promise<Hashes> {
  try { await lstat(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  return tree(root, anchor);
}
/**
 * A registered marketplace root Edu may re-register: the root setup recorded, or an installed
 * edu-agent package (a Node version manager moved the global package root). Anything else is custom.
 */
/**
 * Codex on Windows reports some local paths in extended form (`\\?\C:\...`, `\\?\UNC\server\share\...`)
 * and others in plain form. Both extended forms are reduced to their plain path; other device paths stay.
 */
export function nativePath<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\\\${value.slice(8)}`;
  return /^\\\\\?\\[A-Za-z]:\\/.test(value) ? value.slice(4) : value;
}
/** Path equality as the platform sees it: Windows paths compare case-insensitively, in either slash form. */
export function samePath(a: unknown, b: unknown, platform: NodeJS.Platform = process.platform): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = nativePath(a) as string; const right = nativePath(b) as string;
  if (platform !== 'win32') return left === right;
  const normal = (path: string) => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return normal(left) === normal(right);
}
export function eduOwnedRoot(registered: unknown, previousPackageRoot: string | undefined, platform: NodeJS.Platform = process.platform): registered is string {
  return typeof registered === 'string' && (platform === 'win32' ? win32 : posix).isAbsolute(registered) &&
    (samePath(registered, previousPackageRoot, platform) || /[\\/]node_modules[\\/]edu-agent$/i.test(registered));
}
