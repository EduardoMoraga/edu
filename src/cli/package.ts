/**
 * Locates the installed edu-agent package (works from src/ under vitest and
 * from the bundled dist/cli.js) to read its version and bundled templates.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: { root: string; version: string } | undefined;

function locate(): { root: string; version: string } {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === 'edu-agent') {
          cached = { root: dir, version: pkg.version ?? '0.0.0' };
          return cached;
        }
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate the edu-agent package root');
    dir = parent;
  }
}

export function packageVersion(): string {
  return locate().version;
}

export function packageTemplatesDir(): string {
  return join(locate().root, 'templates');
}
