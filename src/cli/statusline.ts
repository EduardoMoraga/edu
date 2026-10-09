/**
 * `edu statusline`: one line for Claude Code's statusline. Must stay fast
 * (no LLM, no TUI imports): brain stats + optional ctx% from the statusline
 * JSON Claude Code writes to stdin.
 */
import { getGlyphs, renderStatusline } from '../identity/index.js';
import type { CliContext } from './context.js';
import { identityName, lessonCount, openWorkspace } from './workspace.js';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Parses stdin text; returns undefined for empty or invalid JSON (never throws). */
export function parseJsonObject(text: string): Json | undefined {
  if (!text.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Context-window occupancy (0..100) from Claude's statusline input.
 * Prefers `context_window.used_percentage`; otherwise derives it from
 * `current_usage` (input + cache tokens) or `total_input_tokens` over
 * `context_window_size`.
 */
export function ctxPercentFromClaude(input: Json | undefined): number | undefined {
  if (!input) return undefined;
  const direct = num(input.ctxPercent);
  if (direct !== undefined) return direct;
  const win = input.context_window;
  if (!isObject(win)) return undefined;
  const used = num(win.used_percentage);
  if (used !== undefined) return used;
  const size = num(win.context_window_size);
  if (!size || size <= 0) return undefined;
  const current = win.current_usage;
  if (isObject(current)) {
    const tokens =
      (num(current.input_tokens) ?? 0) +
      (num(current.cache_creation_input_tokens) ?? 0) +
      (num(current.cache_read_input_tokens) ?? 0);
    return (tokens / size) * 100;
  }
  const total = num(win.total_input_tokens);
  return total === undefined ? undefined : (total / size) * 100;
}

/** Directory Claude reports for the session, when present. */
export function claudeCwd(input: Json | undefined): string | undefined {
  if (!input) return undefined;
  const ws = input.workspace;
  if (isObject(ws) && typeof ws.current_dir === 'string') return ws.current_dir;
  return typeof input.cwd === 'string' ? input.cwd : undefined;
}

export async function statuslineText(ctx: CliContext, cwd: string, stdinText: string): Promise<string> {
  const input = parseJsonObject(stdinText);
  const { brain, primary } = await openWorkspace(ctx, claudeCwd(input) ?? cwd);
  const [stats, name] = await Promise.all([brain.stats(), identityName(primary.root)]);
  return renderStatusline(
    { brainNotes: stats.total, lessons: lessonCount(stats.byStatus), ctxPercent: ctxPercentFromClaude(input) },
    { glyphs: getGlyphs(ctx.env), name },
  );
}
