import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { BrainLocation } from '../core/contracts.js';

/** The nearest .edu directory overlays a global home, if one exists. */
export async function resolveBrainLocations(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<BrainLocation[]> {
  const locations: BrainLocation[] = [];
  let current = resolve(cwd);
  while (true) {
    const root = join(current, '.edu');
    try {
      if ((await stat(root)).isDirectory()) {
        locations.push({ scope: 'project', root });
        break;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const globalRoot = resolve(env.EDU_HOME || join(env.HOME || homedir(), '.edu'));
  if (!locations.some(location => location.root === globalRoot)) locations.push({ scope: 'global', root: globalRoot });
  return locations;
}
