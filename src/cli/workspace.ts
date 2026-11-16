/**
 * Shared glue for commands: brain locations (nearest project `.edu/` overlaying
 * the global brain), the opened Brain, the effective config and identity name.
 */
import { access } from 'node:fs/promises';
import { openBrain, type Brain } from '../brain/index.js';
import type { BrainLocation } from '../core/contracts.js';
import { resolveBrainLocations } from '../brain/locations.js';
import type { CliContext } from './context.js';

export { effectiveConfig, identityName } from '../workspace/settings.js';

export interface Workspace {
  locations: BrainLocation[];
  /** Where new notes are written: the project brain when present, else global. */
  primary: BrainLocation;
  brain: Brain;
}

export async function openWorkspace(ctx: Pick<CliContext, 'env' | 'home'>, cwd: string): Promise<Workspace> {
  const env = { ...ctx.env, HOME: ctx.env.HOME ?? ctx.home };
  const locations = await resolveBrainLocations(cwd, env);
  return { locations, primary: locations[0]!, brain: openBrain(locations) };
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Active lessons = candidate + proven (these statuses only exist on lessons). */
export function lessonCount(byStatus: Record<string, number>): number {
  return (byStatus.candidate ?? 0) + (byStatus.proven ?? 0);
}
