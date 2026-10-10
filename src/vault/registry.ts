/** Durable list of initialized project brains; missing folders are never pruned. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export interface ProjectEntry { name: string; root: string; brain: string; addedAt: string }
export interface ProjectRegistry { projects: ProjectEntry[] }

export async function readProjects(eduHome: string): Promise<ProjectRegistry> {
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

export async function registerProject(eduHome: string, projectRoot: string): Promise<ProjectEntry> {
  const root = await realpath(resolve(projectRoot));
  const name = basename(root);
  const brain = join(root, '.edu', 'brain');
  const registry = await readProjects(eduHome);
  const existing = registry.projects.find(entry => entry.root === root);
  if (existing) return existing;
  if (registry.projects.some(entry => entry.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Project name conflict in registry: ${name}`);
  }
  const entry: ProjectEntry = { name, root, brain, addedAt: new Date().toISOString() };
  registry.projects.push(entry);
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
  return entry;
}
