/**
 * Containment for files Edu writes inside a brain (notes, `0-index/*`, the usage ledger). A brain is often a
 * synced Git repository, so its content is controlled by whoever can push: a tracked symlink (`0-index/log.md →
 * /home/me/.bashrc`, `3-transitive → /etc`) would otherwise redirect a write outside the brain. Every target is
 * checked component by component below the brain root: a symbolic link or junction on the way, or as the file
 * itself, is refused. The root itself may be reached through a link (`~/.edu/brain → vault/01-CONOCIMIENTO`).
 */
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export class UnsafeBrainPathError extends Error {
  readonly code = 'unsafe-brain-path' as const;
  constructor(message: string) { super(message); this.name = 'UnsafeBrainPathError'; }
}

export const isUnsafeBrainPath = (error: unknown): error is UnsafeBrainPathError => error instanceof UnsafeBrainPathError;

const below = (base: string, path: string): string | undefined => {
  const rel = relative(base, path);
  return rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) ? undefined : rel;
};

/** Canonical (symlink-free) path of each brain root, so a target spelled through the real path still matches. */
const canonicalRoots = new Map<string, string>();
async function canonicalRoot(root: string, fresh = false): Promise<string | undefined> {
  const key = resolve(root);
  if (!fresh && canonicalRoots.has(key)) return canonicalRoots.get(key);
  try { const real = await realpath(key); canonicalRoots.set(key, real); return real; }
  catch { return undefined; }
}

/**
 * Throws `UnsafeBrainPathError` unless `path` lies strictly inside `root` and neither it nor any folder between
 * them is a symbolic link. Missing components are fine (they will be created as plain folders).
 */
export async function assertInsideBrain(root: string, path: string): Promise<void> {
  const target = resolve(path);
  let base = resolve(root);
  let rel = below(base, target);
  if (rel === undefined) {
    // The caller may spell the target through the root's real path (root reached via a link or junction).
    for (const fresh of [false, true]) {
      const real = await canonicalRoot(root, fresh);
      if (real && (rel = below(real, target)) !== undefined) { base = real; break; }
    }
  }
  if (rel === undefined) throw new UnsafeBrainPathError(`refusing to write ${path}: it is outside the brain ${root}`);
  const parts = rel.split(sep);
  let current = base;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      throw new UnsafeBrainPathError(`refusing to write ${parts.join('/')}: ${parts.slice(0, i + 1).join('/')} is a symbolic link inside the brain ${root}`);
    }
  }
}

/** Test hook. */
export function resetCanonicalRoots(): void { canonicalRoots.clear(); }
