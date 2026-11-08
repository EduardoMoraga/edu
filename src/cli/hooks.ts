/**
 * Host CLI hooks written by `edu install`:
 *   Claude  SessionStart → `edu hook session-start` (stdout becomes additional context)
 *   Codex   SessionStart → `edu hook session-start --host codex` (same contract as Claude)
 *   Claude  SessionEnd   → `edu hook session-end`   (hook JSON on stdin)
 *   Codex   notify       → `edu hook codex-notify '<json>'` (JSON as last argv)
 *   agy     SessionStart → `edu hook agy-session-start` (camelCase JSON in, `{ injectSteps }` JSON out)
 * Hooks never fail the host: every error becomes a stderr note and exit 0.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { autoMaintain } from '../brain/auto-maintain.js';
import type { Brain } from '../brain/index.js';
import type { Note } from '../core/contracts.js';
import { withHostLock } from '../platform/file-lock.js';
import type { CliContext } from './context.js';
import { parseJsonObject } from './statusline.js';
import { exists, openWorkspace } from './workspace.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const short = (id: string) => id.slice(0, 8);

/** Re-exported for existing callers; the implementation lives in src/platform/file-lock.ts. */
export { withHostLock };

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

/** Session-start budget: the hook and `edu brief` print the same brief. */
export const SESSION_BRIEF_TOKENS = 1500;

/** The session brief for `cwd`, or undefined when no brain exists there (never creates one, never opens a session). */
export async function workspaceBrief(ctx: CliContext, cwd: string): Promise<{ text: string; ws: NonNullable<Awaited<ReturnType<typeof initializedWorkspace>>> } | undefined> {
  const ws = await initializedWorkspace(ctx, cwd);
  if (!ws) return undefined;
  const { brief } = await import('../context/index.js');
  return { ws, text: await brief(ws.brain, SESSION_BRIEF_TOKENS, { eduMdPath: join(ws.primary.root, 'EDU.md') }) };
}

/** Exact lookup key for a host-reported id: sessions written by hooks carry it as a tag, so retries find them. */
const hostTag = (source: string, key: string) => `host:${source}:${key}`;

async function findHostSession(brain: Brain, tag: string): Promise<Note | undefined> {
  return (await brain.list({ kind: 'session' })).find(note => note.meta.tags.includes(tag));
}

/**
 * Under the host lock: reuses the session already recorded for this host id (open or closed), otherwise opens one,
 * then closes it once when a summary is given. A closed episode is immutable, so retries leave it untouched.
 * Never matches by title or recency.
 */
async function hostSession(root: string, brain: Brain, source: string, key: string, title: string, summary?: string): Promise<Note> {
  return withHostLock(root, source, key, async () => {
    const tag = hostTag(source, key);
    const note = (await findHostSession(brain, tag))
      ?? await brain.write({ tier: 'episodic', kind: 'session', status: 'open-session', title, body: '', source, tags: [tag] });
    if (summary === undefined || note.meta.status !== 'open-session') return note;
    return brain.closeSession(note.meta.id, summary);
  });
}

/** Hosts that share Claude's SessionStart contract and name themselves with `--host` (or Pi, via `source`). */
const HOSTS: Record<string, { source: string; label: string }> = {
  claude: { source: 'claude', label: 'Claude Code' },
  codex: { source: 'codex', label: 'Codex' },
  pi: { source: 'pi', label: 'Pi' },
};

export async function sessionStart(ctx: CliContext, cwd: string, options: { host?: string } = {}): Promise<void> {
  const input = parseJsonObject(await ctx.readStdin(500));
  const result = await workspaceBrief(ctx, str(input?.cwd) ?? cwd);
  if (!result) return;
  const hostId = str(input?.session_id);
  // Only a host that reports both its session id and the start source gets a session; a bare call stays read-only.
  const reported = str(input?.source);
  // Claude's and Codex's `source` is the start trigger (startup/resume/clear/compact), not a host name: the
  // hook command names the host (`--host codex`); Pi names itself in `source`; anything else is Claude Code.
  const host = HOSTS[options.host ?? ''] ?? (reported === 'pi' ? HOSTS.pi! : HOSTS.claude!);
  const session = hostId && reported
    ? await hostSession(result.ws.primary.root, result.ws.brain, host.source, hostId, `${host.label} session ${short(hostId)}`)
    : undefined;
  const text = [result.text.trim(), session ? `Edu session id: ${session.meta.id}` : ''].filter(Boolean).join('\n\n');
  if (text) ctx.out(text);
}

/**
 * Antigravity (agy) SessionStart: the payload is camelCase JSON (`conversationId`, `workspacePaths`) and the
 * hook runs in the plugin directory, so the workspace comes from the payload. Output is always one JSON
 * object; the brief travels as an injected system message.
 */
export async function agySessionStart(ctx: CliContext, cwd: string): Promise<void> {
  let text = '';
  try {
    const input = parseJsonObject(await ctx.readStdin(500));
    const paths = Array.isArray(input?.workspacePaths) ? input.workspacePaths.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [];
    const result = await workspaceBrief(ctx, paths[0] ?? cwd);
    if (result) {
      const conversation = str(input?.conversationId);
      const session = conversation
        ? await hostSession(result.ws.primary.root, result.ws.brain, 'agy', conversation, `Antigravity session ${short(conversation)}`)
        : undefined;
      text = [result.text.trim(), session ? `Edu session id: ${session.meta.id}` : ''].filter(Boolean).join('\n\n');
    }
  } finally {
    // agy parses stdout as JSON: emit an object even when there is no brain or the brief failed.
    ctx.out(JSON.stringify(text ? { injectSteps: [{ systemMessage: { systemMessage: text } }] } : {}));
  }
}

export async function sessionEnd(ctx: CliContext, cwd: string): Promise<void> {
  const input = parseJsonObject(await ctx.readStdin(1000));
  const sessionId = str(input?.session_id);
  if (!input || !sessionId) throw new Error('expected Claude SessionEnd JSON with session_id on stdin');
  const ws = await initializedWorkspace(ctx, str(input.cwd) ?? cwd);
  if (!ws) return;
  // Same attribution as session-start: Pi names itself; Claude's `source` is never a host name here.
  const host = str(input.source) === 'pi' ? { source: 'pi', label: 'Pi' } : { source: 'claude', label: 'Claude Code' };
  const transcript = str(input.transcript_path);
  const reason = str(input.reason);
  const summary = [
    `${host.label} session ${sessionId} ended${reason ? ` (${reason})` : ''}.`,
    transcript ? `Transcript: ${transcript} (path only; its content was not read or summarized).` : 'Transcript: not reported.',
  ].join('\n');
  await hostSession(ws.primary.root, ws.brain, host.source, sessionId, `${host.label} session ${short(sessionId)}`, summary);
  await autoMaintain(ws.brain, ws.primary.root);
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
    'Captured: clipped question/answer only; nothing else was extracted.',
  ]
    .filter(Boolean)
    .join('\n');
  // One episode per turn: the turn id when reported, otherwise a digest of the payload, so a retried notify adds nothing.
  const turn = str(input['turn-id']) ?? createHash('sha256').update(JSON.stringify([thread, messages, last ?? ''])).digest('hex').slice(0, 16);
  await hostSession(ws.primary.root, ws.brain, 'codex', `${thread}:${turn}`, `Codex turn ${short(thread)}`, summary);
  await autoMaintain(ws.brain, ws.primary.root);
}
