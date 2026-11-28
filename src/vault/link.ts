/**
 * Obsidian vault link: `<vault>/Edu/<project>` → the brain's Markdown folder.
 * Symlink on POSIX, junction on Windows. Never replaces anything that
 * already exists and points elsewhere.
 */
import { realpathSync } from 'node:fs';
import { lstat, mkdir, readlink, symlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { BrainLocation } from '../core/contracts.js';
import { brainPath } from '../brain/location.js';

export type LinkState = 'ok' | 'missing' | 'conflict';

/** Folder name inside `<vault>/Edu/`: the project directory name, or "_global". */
export function linkName(location: BrainLocation): string {
  return location.scope === 'global' ? '_global' : basename(dirname(location.root)) || 'project';
}

export function brainDir(location: BrainLocation): string {
  return brainPath(location);
}

export function linkPath(vault: string, location: BrainLocation): string {
  return join(resolve(vault), 'Edu', linkName(location));
}

/** Drops the `\\?\` prefix some Windows native realpaths keep. Volume device paths stay. */
function plainAbsolute(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`;
  if (/^\\\\\?\\[A-Za-z]:\\/.test(path)) return path.slice(4);
  return path;
}

/**
 * One spelling of a directory. Native realpath turns a Windows 8.3 name (`RUNNER~1`) into the long name,
 * so two paths to the same folder compare equal. Throws when the path is missing or the link is broken.
 */
export async function canonicalPath(path: string): Promise<string> {
  return plainAbsolute(realpathSync.native(path));
}

async function samePath(a: string, b: string): Promise<boolean> {
  const left = await canonicalPath(a).catch(() => plainAbsolute(resolve(a)));
  const right = await canonicalPath(b).catch(() => plainAbsolute(resolve(b)));
  return left === right;
}

export async function linkState(link: string, target: string): Promise<LinkState> {
  let info;
  try {
    info = await lstat(link);
  } catch {
    return 'missing';
  }
  if (!info.isSymbolicLink()) return 'conflict';
  const pointsTo = resolve(dirname(link), await readlink(link));
  return (await samePath(pointsTo, target)) ? 'ok' : 'conflict';
}

/** Creates the link; returns 'exists' when it is already correct, throws on conflict. */
export async function createVaultLink(
  link: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
): Promise<'created' | 'exists'> {
  const state = await linkState(link, target);
  if (state === 'ok') return 'exists';
  if (state === 'conflict') throw Object.assign(new Error(`link conflict: ${link}`), { code: 'ELINKCONFLICT' });
  await mkdir(dirname(link), { recursive: true });
  await mkdir(target, { recursive: true });
  await symlink(resolve(target), link, platform === 'win32' ? 'junction' : 'dir');
  return 'created';
}
