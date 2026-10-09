/**
 * Host CLI hooks written by `edu install`:
 *   Claude  SessionStart → `edu hook session-start` (stdout becomes additional context)
 *   Claude  SessionEnd   → `edu hook session-end`   (hook JSON on stdin)
 *   Codex   notify       → `edu hook codex-notify '<json>'` (JSON as last argv)
 * Hooks never fail the host: every error becomes a stderr note and exit 0.
 */
import { join } from 'node:path';
import type { CliContext } from './context.js';
import { parseJsonObject } from './statusline.js';
import { exists, openWorkspace } from './workspace.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const short = (id: string) => id.slice(0, 8);

/** Runs a hook body; any failure is reported on stderr and swallowed. */
export async function safeHook(ctx: CliContext, name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    ctx.err(`edu hook ${name}: ${error instanceof Error ? error.message : String(error)} (ignored)`);
  }
  ctx.setExitCode(0);
}

/** Opens the workspace only when a brain exists; hooks never create one implicitly. */
async function initializedWorkspace(ctx: CliContext, cwd: string) {
  const ws = await openWorkspace(ctx, cwd);
  return (await exists(join(ws.primary.root, 'EDU.md'))) ? ws : undefined;
}

export async function sessionStart(ctx: CliContext, cwd: string): Promise<void> {
  const input = parseJsonObject(await ctx.readStdin(500));
  const ws = await initializedWorkspace(ctx, str(input?.cwd) ?? cwd);
  if (!ws) return;
  const { brief } = await import('../context/index.js');
  const text = await brief(ws.brain, 1500, { eduMdPath: join(ws.primary.root, 'EDU.md') });
  if (text.trim()) ctx.out(text);
}

export async function sessionEnd(ctx: CliContext, cwd: string): Promise<void> {
  const input = parseJsonObject(await ctx.readStdin(1000));
  const sessionId = str(input?.session_id);
  if (!input || !sessionId) throw new Error('expected Claude SessionEnd JSON with session_id on stdin');
  const ws = await initializedWorkspace(ctx, str(input.cwd) ?? cwd);
  if (!ws) return;
  const transcript = str(input.transcript_path);
  const reason = str(input.reason);
  const summary = [
    `Claude Code session ${sessionId} ended${reason ? ` (${reason})` : ''}.`,
    transcript ? `Transcript: ${transcript}` : 'Transcript: not reported.',
  ].join('\n');
  const note = await ws.brain.openSession(`Claude Code session ${short(sessionId)}`, 'claude');
  await ws.brain.closeSession(note.meta.id, summary);
}

export async function codexNotify(ctx: CliContext, cwd: string, payload: string | undefined): Promise<void> {
  const input = parseJsonObject(payload ?? '');
  if (!input) throw new Error('expected Codex notify JSON as the last argument');
  if (input.type !== 'agent-turn-complete') return;
  const ws = await initializedWorkspace(ctx, str(input.cwd) ?? cwd);
  if (!ws) return;
  const thread = str(input['thread-id']) ?? str(input['turn-id']) ?? 'unknown';
  const messages = Array.isArray(input['input-messages']) ? input['input-messages'].filter((m): m is string => typeof m === 'string') : [];
  const last = str(input['last-assistant-message']);
  const summary = [
    `Codex turn completed (thread ${thread}).`,
    messages[0] ? `Asked: ${clip(messages[0], 200)}` : undefined,
    last ? `Answered: ${clip(last, 400)}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  const note = await ws.brain.openSession(`Codex turn ${short(thread)}`, 'codex');
  await ws.brain.closeSession(note.meta.id, summary);
}
