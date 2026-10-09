/**
 * Shared glue for commands: brain locations (nearest project `.edu/` overlaying
 * the global brain), the opened Brain, the effective config and identity name.
 */
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openBrain, type Brain } from '../brain/index.js';
import type { BrainLocation, CliId, EduConfig } from '../core/contracts.js';
import { resolveBrainLocations } from '../mcp/locations.js';
import type { CliContext } from './context.js';

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

/** Loads `<root>/config.json`; falls back to defaults with the first detected CLI. */
export async function effectiveConfig(root: string, detected: CliId[]): Promise<EduConfig> {
  // Lazy: keeps zod out of fast paths such as `edu statusline`.
  const { defaultConfig, loadConfig } = await import('../orchestrator/config.js');
  const path = join(root, 'config.json');
  if (await exists(path)) return loadConfig(path);
  return defaultConfig(detected[0] ?? 'claude');
}

/** Identity name from the first heading of EDU.md (`# Name — the contract`). */
export async function identityName(root: string): Promise<string> {
  try {
    const text = await readFile(join(root, 'EDU.md'), 'utf8');
    const heading = /^#\s+(.+?)(?:\s+[—-]\s+.*)?$/m.exec(text)?.[1]?.trim();
    return heading && heading !== '{{name}}' ? heading : 'Edu';
  } catch {
    return 'Edu';
  }
}

/** Active lessons = candidate + proven (these statuses only exist on lessons). */
export function lessonCount(byStatus: Record<string, number>): number {
  return (byStatus.candidate ?? 0) + (byStatus.proven ?? 0);
}
