/**
 * The machine-local folder of a brain root (`<root>/.edu-local`): exposure ledger, parsed-note cache, locks.
 * Never synced: `ensureLocalIgnored` keeps it out of git.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertInsideBrain, isUnsafeBrainPath } from './safe-path.js';

/** Machine-local folder inside a brain root; git-ignored through `<root>/.gitignore`. */
export const LOCAL_DIR = '.edu-local';

/** True when `path` may be read or written inside `root` (no symlink on the way); warns and returns false otherwise. */
export async function safeLocalTarget(root: string, path: string, quiet = false): Promise<boolean> {
  try { await assertInsideBrain(root, path); return true; }
  catch (error) {
    if (!isUnsafeBrainPath(error)) throw error;
    if (!quiet) process.emitWarning(`${error.message}; skipped`, 'EduWarning');
    return false;
  }
}

const ignored = new Set<string>();
/**
 * Makes sure `<root>/.gitignore` ignores the machine-local folder, so a brain root inside a git repository
 * (a project `.edu`, or a synced `~/.edu`) never commits it. Appends to an existing file; never rewrites it.
 */
export async function ensureLocalIgnored(root: string): Promise<void> {
  const key = resolve(root);
  if (ignored.has(key)) return;
  const path = join(root, '.gitignore');
  if (!await safeLocalTarget(root, path)) return;
  const current = await readFile(path, 'utf8').catch(() => undefined);
  const rules = (current ?? '').split(/\r?\n/).map(line => line.trim());
  if (!rules.some(rule => [LOCAL_DIR, `${LOCAL_DIR}/`, `/${LOCAL_DIR}`, `/${LOCAL_DIR}/`].includes(rule))) {
    if (current === undefined) await writeFile(path, `${LOCAL_DIR}/\n`, { flag: 'wx' }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return appendFile(path, `${LOCAL_DIR}/\n`);
      throw error;
    });
    else await appendFile(path, `${current && !current.endsWith('\n') ? '\n' : ''}${LOCAL_DIR}/\n`);
  }
  ignored.add(key);
}
