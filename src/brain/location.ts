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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BrainLocation, WorkspaceIdentity } from '../core/contracts.js';

export interface WorkspaceSettings { brainDir?: string; sourcesDir?: string; identity?: WorkspaceIdentity }

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

/** The brain-relative prefix Obsidian sees for a tier folder (vault = workspace root when brainDir is set). */
/**
 * A brain folder's path as Obsidian sees it: relative to the nearest enclosing vault (a folder with
 * `.obsidian/`), following symlinks so a global brain linked into a vault still matches. Without an
 * enclosing vault it falls back to the path below the workspace root.
 */
export function vaultFolder(location: BrainLocation, folder: string): string {
  const brain = brainPath(location);
  let real = brain;
  try { real = realpathSync(brain); } catch { /* not created yet */ }
  for (let dir = dirname(real); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, '.obsidian'))) return `${relative(dir, real).split(sep).join('/')}/${folder}`;
  }
  if (!location.brainDir) return `brain/${folder}`;
  const rel = relative(dirname(resolve(location.root)), location.brainDir).split(sep).join('/');
  return `${rel}/${folder}`;
}
