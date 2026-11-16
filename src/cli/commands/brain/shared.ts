/** Helpers shared by the `edu brain` subcommand groups. */
import { join } from 'node:path';
import type { CliContext } from '../../context.js';
import type { Lang } from '../../i18n.js';
import { exists, openWorkspace, type Workspace } from '../../workspace.js';

export function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${flag} must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

/** Opens the workspace and requires an initialized primary brain (writes go there). */
export async function writableWorkspace(ctx: CliContext, cwd: string, lang: Lang): Promise<Workspace> {
  const ws = await openWorkspace(ctx, cwd);
  if (!(await exists(join(ws.primary.root, 'EDU.md')))) {
    throw new Error(lang === 'es' ? 'No hay cerebro inicializado — ejecuta: edu init' : 'No brain found — run: edu init');
  }
  return ws;
}

/** Commander collector for a repeatable option. */
export const collect = (value: string, previous: string[]) => [...previous, value];
