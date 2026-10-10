/**
 * Post-update migration hook (`edu internal migrate-workspaces`): for every registered workspace,
 * run maintenance with the new code, which also rebuilds the index and the Obsidian `.base` files.
 * Missing folders are skipped (the registry never prunes them); one broken workspace never stops the rest.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { autoMaintain } from '../brain/auto-maintain.js';
import { openBrain } from '../brain/brain.js';
import { withBrainDir } from '../brain/location.js';
import { readProjects } from '../vault/registry.js';

export type MigrationStatus = 'migrated' | 'missing' | 'no-brain' | 'failed';
export interface WorkspaceMigration { name: string; root: string; status: MigrationStatus; detail?: string }

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function migrateWorkspaces(eduHome: string, now = new Date()): Promise<WorkspaceMigration[]> {
  const { projects } = await readProjects(eduHome);
  const results: WorkspaceMigration[] = [];
  for (const project of projects) {
    const base = { name: project.name, root: project.root };
    if (!(await exists(project.root))) { results.push({ ...base, status: 'missing' }); continue; }
    const eduRoot = join(project.root, '.edu');
    if (!(await exists(join(eduRoot, 'EDU.md')))) { results.push({ ...base, status: 'no-brain' }); continue; }
    try {
      const location = await withBrainDir({ scope: 'project', root: eduRoot });
      const outcome = await autoMaintain(openBrain([location]), eduRoot, { force: true, now });
      if (!outcome.ran) results.push({ ...base, status: 'failed', detail: outcome.reason });
      else results.push({ ...base, status: 'migrated', detail: `${outcome.report.changed.length} changed · index rebuilt` });
    } catch (error) {
      results.push({ ...base, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
