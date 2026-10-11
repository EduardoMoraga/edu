/**
 * Durable list of initialized project brains; missing folders are never pruned.
 *
 * The stored `brain` field is kept for compatibility, but it is derived: every read resolves it again
 * from the workspace's `.edu/config.json` (`brainDir`), so `edu init` before `edu create` or a later
 * config edit never leaves a stale path. Entries whose `.edu/` is gone, or whose config is invalid,
 * keep the stored value.
 */
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { brainPath, withBrainDir } from '../brain/location.js';

export interface ProjectEntry { name: string; root: string; brain: string; addedAt: string }
export interface ProjectRegistry { projects: ProjectEntry[] }

/** The brain folder a workspace's config points to now; undefined when it cannot be resolved. */
async function liveBrain(root: string): Promise<string | undefined> {
  const eduRoot = join(root, '.edu');
  try { await access(eduRoot); } catch { return undefined; }
  try { return brainPath(await withBrainDir({ scope: 'project', root: eduRoot })); } catch { return undefined; }
}

async function withLiveBrains(registry: ProjectRegistry): Promise<ProjectRegistry> {
  return { projects: await Promise.all(registry.projects.map(async entry => ({ ...entry, brain: (await liveBrain(entry.root)) ?? entry.brain }))) };
}

async function readStored(eduHome: string): Promise<ProjectRegistry> {
  let raw: string;
  try { raw = await readFile(join(eduHome, 'projects.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { projects: [] };
    throw error;
  }
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('projects' in data) || !Array.isArray(data.projects)
    || !data.projects.every((entry: unknown) => entry && typeof entry === 'object'
      && ['name', 'root', 'brain', 'addedAt'].every(key => typeof (entry as Record<string, unknown>)[key] === 'string'))) {
    throw new Error(`Invalid project registry: ${join(eduHome, 'projects.json')}`);
  }
  return data as ProjectRegistry;
}

/** Registered workspaces, with each `brain` resolved from the workspace's current config. */
export async function readProjects(eduHome: string): Promise<ProjectRegistry> {
  return withLiveBrains(await readStored(eduHome));
}

/** Rewrites stale stored brain paths (used by `edu internal migrate-workspaces`); returns the entries it changed. */
export async function refreshProjects(eduHome: string): Promise<ProjectEntry[]> {
  const stored = await readStored(eduHome);
  const live = await withLiveBrains(stored);
  const changed = live.projects.filter((entry, i) => entry.brain !== stored.projects[i]!.brain);
  if (changed.length) await writeRegistry(eduHome, live);
  return changed;
}

export async function registerProject(eduHome: string, projectRoot: string): Promise<ProjectEntry> {
  const root = await realpath(resolve(projectRoot));
  const name = basename(root);
  const brain = brainPath(await withBrainDir({ scope: 'project', root: join(root, '.edu') }));
  const registry = await readStored(eduHome);
  const existing = registry.projects.find(entry => entry.root === root);
  if (existing) {
    if (existing.brain === brain) return existing;
    existing.brain = brain;
    await writeRegistry(eduHome, registry);
    return existing;
  }
  if (registry.projects.some(entry => entry.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project name conflict in registry: ${name}`);
  }
  const entry: ProjectEntry = { name, root, brain, addedAt: new Date().toISOString() };
  registry.projects.push(entry);
  await writeRegistry(eduHome, registry);
  return entry;
}

async function writeRegistry(eduHome: string, registry: ProjectRegistry): Promise<void> {
  const path = join(eduHome, 'projects.json');
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
