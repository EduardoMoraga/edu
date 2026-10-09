/** Small helpers shared by command modules: action wrapper, JSON output, status lines. */
import type { Command } from 'commander';
import { detectTheme, getGlyphs, type Glyphs, type Theme } from '../identity/index.js';
import { resolveGlobals, type CliContext, type Resolved } from './context.js';
import { t } from './i18n.js';

export interface ActionEnv<O> {
  ctx: CliContext;
  g: Resolved;
  opts: O;
  cmd: Command;
}

/**
 * Wraps a command body: resolves global flags, and turns thrown errors into a
 * one-line `edu: <message>` on stderr with exit code 1 (no stack traces).
 */
export function action<O = Record<string, unknown>>(
  ctx: CliContext,
  body: (env: ActionEnv<O>, ...args: string[]) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args.at(-1) as Command;
    const g = resolveGlobals(ctx, cmd.optsWithGlobals());
    const positionals = args.slice(0, -2).map((a) => (Array.isArray(a) ? a.join(' ') : (a as string)));
    try {
      await body({ ctx, g, opts: cmd.opts() as O, cmd }, ...positionals);
    } catch (error) {
      ctx.err(t(g.lang, 'error.prefix', { message: error instanceof Error ? error.message : String(error) }));
      ctx.setExitCode(1);
    }
  };
}

export function printJson(ctx: CliContext, value: unknown): void {
  ctx.out(JSON.stringify(value, null, 2));
}

export interface Look {
  glyphs: Glyphs;
  theme: Theme;
}

export function look(ctx: CliContext): Look {
  return { glyphs: getGlyphs(ctx.env), theme: detectTheme(ctx.env, ctx.isTTY) };
}

export type Level = 'ok' | 'warn' | 'fail';

/** `✓ text` / `! text` / `✗ text`, colored when the terminal allows it. */
export function statusLine({ glyphs, theme }: Look, level: Level, text: string): string {
  const mark = level === 'ok' ? glyphs.ok : level === 'warn' ? '!' : glyphs.fail;
  const tone = level === 'ok' ? 'success' : level === 'warn' ? 'accent' : 'danger';
  return `${theme.paint(tone, mark, { bold: true })} ${text}`;
}

export function parseIntOption(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return n;
}

export function parsePositive(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${value}"`);
  return n;
}
