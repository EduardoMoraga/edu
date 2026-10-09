/**
 * Obsidian vault link: `<vault>/Edu/<project>` → the brain's Markdown folder.
 * Symlink on POSIX, junction on Windows. Never replaces anything that
 * already exists and points elsewhere.
 */
import { lstat, mkdir, readlink, realpath, symlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { BrainLocation } from '../core/contracts.js';

export type LinkState = 'ok' | 'missing' | 'conflict';

/** Folder name inside `<vault>/Edu/`: the project directory name, or "global". */
export function linkName(location: BrainLocation): string {
  return location.scope === 'global' ? 'global' : basename(dirname(location.root)) || 'project';
}

export function brainDir(location: BrainLocation): string {
  return join(location.root, 'brain');
}

export function linkPath(vault: string, location: BrainLocation): string {
  return join(resolve(vault), 'Edu', linkName(location));
}

async function samePath(a: string, b: string): Promise<boolean> {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return resolve(a) === resolve(b);
  }
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
