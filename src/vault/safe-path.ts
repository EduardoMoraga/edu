/**
 * Writes Edu makes inside a Git repository (`.gitignore`, merged logs, join imports, conflict copies) must stay
 * inside it. The repository content is controlled by whoever can push, so a tracked symlink (`.gitignore →
 * /etc/…`, `notes → /home/me`) could redirect a write. Every path is checked component by component from the
 * repository root: a symbolic link or junction on the way, or as the file itself, is refused.
 * The root itself may be reached through a link (the brain is often a junction into the vault).
 */
import { lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export class UnsafePathError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsafePathError'; }
}

/** Throws unless `path` is inside `root` and neither it nor any folder between them is a symbolic link. */
export async function assertSafeTarget(root: string, path: string): Promise<void> {
  const rel = relative(resolve(root), resolve(path));
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new UnsafePathError(`refusing to write ${path}: it is outside the repository ${root}`);
  }
  let current = resolve(root);
  const parts = rel.split(sep);
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      const shown = parts.slice(0, i + 1).join('/');
      throw new UnsafePathError(`refusing to write ${parts.join('/')}: ${shown} is a symbolic link in the repository`);
    }
  }
}
