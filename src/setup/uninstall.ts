/**
 * `edu uninstall`: undo exactly what `edu setup` / `edu install` recorded, for the global scope and the
 * current project. The brain is never touched unless the caller asks to purge it (the CLI confirms first).
 */
import { lstat, readFile, rm, rmdir } from 'node:fs/promises';
import { join, parse, relative, resolve, sep } from 'node:path';
import type { InstallScope } from '../core/contracts.js';
import { getManifestPath, uninstall } from '../adapters/installer.js';
import { setupManifestPath, uninstallSetup, type SetupRunner } from './index.js';

export interface UninstallEduOptions {
  home: string;
  cwd: string;
  /** The global brain (EDU_HOME or ~/.edu). */
  brainRoot: string;
  /** Limit to one scope; both when omitted. */
  scope?: InstallScope;
  force?: boolean;
  runner?: SetupRunner;
  /** Delete the global brain after removing integrations. The caller must have confirmed. */
  purgeBrain?: boolean;
}

export interface UninstallEduReport {
  removed: Array<{ scope: InstallScope; via: 'setup' | 'manifest'; path: string }>;
  brain: { path: string; action: 'kept' | 'purged' | 'absent' };
}

async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function manifestScope(path: string): Promise<InstallScope | undefined> {
  try { return (JSON.parse(await readFile(path, 'utf8')) as { scope?: InstallScope }).scope; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/**
 * Refuses to delete anything that does not look like an Edu brain, or that contains the home directory
 * (EDU_HOME=~ would otherwise take the whole home with it).
 */
export async function assertPurgeableBrain(brainRoot: string, home: string): Promise<void> {
  const root = resolve(brainRoot);
  const rel = relative(root, resolve(home));
  if (root === parse(root).root || rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))) {
    throw new Error(`Refusing to purge ${root}: it contains the home directory`);
  }
  const markers = await Promise.all(['EDU.md', 'config.json'].map(name => present(join(root, name))));
  if (!markers.some(Boolean)) throw new Error(`Refusing to purge ${root}: no EDU.md or config.json, so it is not an Edu brain`);
}

/** Idempotent: a second run finds no manifests and removes nothing. */
export async function uninstallEdu(options: UninstallEduOptions): Promise<UninstallEduReport> {
  const home = resolve(options.home);
  const cwd = resolve(options.cwd);
  const removed: UninstallEduReport['removed'] = [];
  if (options.scope !== 'global') {
    const path = getManifestPath('project', cwd, home);
    // In HOME the project manifest path is the global one; only a project-scoped manifest counts here.
    if (await manifestScope(path) === 'project') {
      await uninstall({ manifestPath: path, force: options.force });
      removed.push({ scope: 'project', via: 'manifest', path });
    }
  }
  if (options.scope !== 'project') {
    const setup = await setupManifestPath(home);
    const adapter = getManifestPath('global', cwd, home);
    if (await present(setup)) {
      await uninstallSetup({ home, runner: options.runner, force: options.force });
      removed.push({ scope: 'global', via: 'setup', path: setup });
    }
    // `edu install --scope global` without `edu setup`, or a setup run that left its adapter manifest behind.
    if (await manifestScope(adapter) === 'global') {
      await uninstall({ manifestPath: adapter, force: options.force });
      removed.push({ scope: 'global', via: 'manifest', path: adapter });
    }
  }
  const brainRoot = resolve(options.brainRoot);
  const exists = await present(brainRoot);
  if (!options.purgeBrain || !exists) return { removed, brain: { path: brainRoot, action: exists ? 'kept' : 'absent' } };
  await assertPurgeableBrain(brainRoot, home);
  await rm(brainRoot, { recursive: true, force: true });
  // With EDU_HOME elsewhere, ~/.edu held only setup manifests; drop it once they are gone.
  if (join(home, '.edu') !== brainRoot) await rmdir(join(home, '.edu')).catch(() => undefined);
  return { removed, brain: { path: brainRoot, action: 'purged' } };
}
