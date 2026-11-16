/**
 * Locates the running edu-agent package (from src/ under vitest and from the bundled dist/cli.js) to read
 * its version and bundled templates. The only package-root walker: every caller goes through it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageInfo { root: string; version: string }

let cached: PackageInfo | undefined;

/** The nearest `package.json` named `edu-agent` at or above `from`. */
export function findPackageRoot(from: string): PackageInfo {
  let dir = from;
  while (true) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === 'edu-agent') return { root: dir, version: pkg.version ?? '0.0.0' };
      } catch { /* keep walking */ }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate the edu-agent package root');
    dir = parent;
  }
}

function locate(): PackageInfo {
  cached ??= findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  return cached;
}

export const packageRoot = (): string => locate().root;
export const packageVersion = (): string => locate().version;
export const packageTemplatesDir = (): string => join(locate().root, 'templates');
