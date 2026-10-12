/**
 * The one resolver for where a brain's Markdown lives.
 *
 * A location's `root` is the `.edu/` directory (EDU.md, config.json, playbooks, state…). The brain
 * folder (0-index, 1-canonical, 2-episodic, 3-transitive) defaults to `<root>/brain`; a workspace can
 * move it with `brainDir` in `.edu/config.json`, relative to the workspace root (the folder holding
 * `.edu/`), e.g. `01-CONOCIMIENTO` so the brain is visible in Obsidian. Everything that reads or writes
 * notes goes through `brainPath()`.
 */
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BrainLocation, WorkspaceIdentity } from '../core/contracts.js';

/**
 * True when the upward search for a project `.edu/` must not climb from `dir` into `parent`.
 * `EDU_CEILING_DIRECTORIES` (a `path.delimiter`-separated list, like Git's GIT_CEILING_DIRECTORIES)
 * bounds the search; unset, the search climbs to the filesystem root as before. On Windows the
 * temp dir lives under the user's home, so tests set it to keep a real `~/.edu` out of reach.
 */
export function stopsAtCeiling(parent: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = env.EDU_CEILING_DIRECTORIES;
  if (!list) return false;
  const norm = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
  const target = norm(parent);
  return list.split(delimiter).filter(Boolean).some(entry => norm(entry) === target);
}

export interface WorkspaceSettings { brainDir?: string; sourcesDir?: string; identity?: WorkspaceIdentity; lang?: 'en' | 'es' }

/** The brain folder of a location. */
export function brainPath(location: BrainLocation): string {
  return location.brainDir ?? join(location.root, 'brain');
}

/** True when `child` is `parent` or inside it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Absolute brain folder for an `.edu` root and a configured (relative) `brainDir`. */
export function resolveBrainDir(eduRoot: string, brainDir: string | undefined): string {
  if (brainDir === undefined || brainDir.trim() === '') return join(eduRoot, 'brain');
  const workspace = dirname(resolve(eduRoot));
  const target = resolve(workspace, brainDir);
  if (isAbsolute(brainDir) || !isInside(workspace, target) || target === workspace) {
    throw new Error(`Invalid brainDir "${brainDir}" in ${join(eduRoot, 'config.json')}: use a folder inside the workspace, e.g. "01-KNOWLEDGE"`);
  }
  return target;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Workspace fields of `<eduRoot>/config.json`, read leniently (no zod: hooks and the statusline stay fast). */
export async function readWorkspaceSettings(eduRoot: string): Promise<WorkspaceSettings> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(eduRoot, 'config.json'), 'utf8')); }
  catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const config = raw as Record<string, unknown>;
  const settings: WorkspaceSettings = {};
  const brainDir = text(config.brainDir);
  if (brainDir) settings.brainDir = brainDir;
  const sourcesDir = text(config.sourcesDir);
  if (sourcesDir) settings.sourcesDir = sourcesDir;
  if (config.lang === 'en' || config.lang === 'es') settings.lang = config.lang;
  const identity = config.identity as Record<string, unknown> | undefined;
  const name = text(identity?.name);
  if (identity && typeof identity === 'object' && name) {
    settings.identity = { name, ...(text(identity.role) ? { role: text(identity.role) } : {}), ...(text(identity.tone) ? { tone: text(identity.tone) } : {}), ...(text(identity.summary) ? { summary: text(identity.summary) } : {}) };
  }
  return settings;
}

/** Fills `brainDir` from the location's config when it moves the brain; otherwise returns it unchanged. */
export async function withBrainDir(location: BrainLocation): Promise<BrainLocation> {
  if (location.brainDir) return location;
  const { brainDir } = await readWorkspaceSettings(location.root);
  return brainDir ? { ...location, brainDir: resolveBrainDir(location.root, brainDir) } : location;
}

/** Where a brain sits inside its enclosing Obsidian vault: the vault folder and the brain's vault-relative path ('/'-separated). */
export interface VaultPlacement { vault: string; brainRel: string }

/**
 * The nearest enclosing vault (a folder with `.obsidian/`) of a brain folder, following symlinks so a
 * global brain linked into a vault still matches. Undefined when no ancestor is a vault.
 */
export function vaultPlacement(location: BrainLocation): VaultPlacement | undefined {
  const brain = brainPath(location);
  let real = brain;
  try { real = realpathSync(brain); } catch { /* not created yet */ }
  for (let dir = dirname(real); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, '.obsidian'))) return { vault: dir, brainRel: relative(dir, real).split(sep).join('/') };
  }
  return undefined;
}

/**
 * A brain folder's path as Obsidian sees it: relative to the nearest enclosing vault (see
 * `vaultPlacement`). Without an enclosing vault it falls back to the path below the workspace root.
 */
export function vaultFolder(location: BrainLocation, folder: string): string {
  const placed = vaultPlacement(location);
  if (placed) return `${placed.brainRel}/${folder}`;
  if (!location.brainDir) return `brain/${folder}`;
  const rel = relative(dirname(resolve(location.root)), location.brainDir).split(sep).join('/');
  return `${rel}/${folder}`;
}
