/**
 * `edu uninstall`: undo exactly what `edu setup` / `edu install` recorded, for the global scope and the
 * current project. The brain is never touched unless the caller asks to purge it (the CLI confirms first).
 */
import { lstat, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
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

/** Case-insensitive file systems (Windows, default macOS) compare paths without case. */
function comparable(path: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? path.toLowerCase() : path;
}

/** True when `child` is `parent` or inside it, on canonical paths. */
function within(parent: string, child: string): boolean {
  const rel = relative(comparable(parent), comparable(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !isAbsolute(rel));
}

/** Canonical path of an existing path; for a missing one, the canonical nearest ancestor plus the rest. */
async function canonical(path: string): Promise<string> {
  const target = resolve(path);
  try { return await realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(target) === target) throw error;
    return join(await canonical(dirname(target)), basename(target));
  }
}

async function kind(path: string): Promise<'file' | 'dir' | 'link' | 'other' | 'absent'> {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw error; }
}

/** A tier folder of an Edu brain, as `edu init` lays it out. */
const TIER_FOLDERS = ['0-index', '1-canonical', '2-episodic', '3-transitive'];

/**
 * Refuses to delete anything that is not unmistakably an Edu brain, or that holds the home directory.
 * Every comparison runs on canonical (realpath) paths, so a symlinked or junctioned ancestor cannot
 * smuggle the home in (`<alias>/home` where alias points at the home's parent). Returns the canonical
 * directory that may be removed.
 */
export async function assertPurgeableBrain(brainRoot: string, home: string): Promise<string> {
  const lexical = resolve(brainRoot);
  // The target itself must be a real directory: purging a link would delete whatever it points at.
  const top = await kind(lexical);
  if (top === 'link') throw new Error(`Refusing to purge ${lexical}: it is a symlink or junction`);
  if (top !== 'dir') throw new Error(`Refusing to purge ${lexical}: not a directory, so it is not an Edu brain`);
  const root = await canonical(lexical);
  const homes = [resolve(home), await canonical(home)];
  if (root === parse(root).root || homes.some(h => within(root, h))) {
    throw new Error(`Refusing to purge ${root}: it is or contains the home directory`);
  }
  // Strong ownership markers: the EDU.md contract plus a brain layout, none of them links.
  const eduMd = await kind(join(root, 'EDU.md'));
  const brain = await kind(join(root, 'brain'));
  if (eduMd === 'link' || brain === 'link') throw new Error(`Refusing to purge ${root}: its EDU.md or brain/ is a symlink`);
  let layout = false;
  if (brain === 'dir') layout = (await Promise.all(TIER_FOLDERS.map(name => kind(join(root, 'brain', name))))).some(k => k === 'dir');
  else if (brain === 'absent') {
    // A vault-placed brain (`brainDir` in config.json) keeps its notes outside this folder.
    try { layout = typeof JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))?.brainDir === 'string'; }
    catch { layout = false; }
  }
  if (eduMd !== 'file' || !layout) throw new Error(`Refusing to purge ${root}: no EDU.md with a brain/ tier layout, so it is not an Edu brain`);
  return root;
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
  const target = await assertPurgeableBrain(brainRoot, home);
  // Integration removal ran in between: validate again right before deleting, on the same canonical path.
  if (await assertPurgeableBrain(target, home) !== target) throw new Error(`Refusing to purge ${brainRoot}: it moved during uninstall`);
  // fs.rm unlinks symlinks inside the tree without following them; the top is a checked real directory.
  await rm(target, { recursive: true, force: true });
  // With EDU_HOME elsewhere, ~/.edu held only setup manifests; drop it once they are gone.
  if (join(home, '.edu') !== brainRoot) await rmdir(join(home, '.edu')).catch(() => undefined);
  return { removed, brain: { path: brainRoot, action: 'purged' } };
}
