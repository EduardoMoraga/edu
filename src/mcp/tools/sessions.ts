/** Session tools: open (or reuse) a work session and close it with a summary and optional lessons. */
import { z } from 'zod';
import { autoMaintain } from '../../reflect/auto-maintain.js';
import { withHostLock } from '../../platform/file-lock.js';
import { closeWithLessons, lessonsInput } from '../session-learning.js';
import { noteLine as line, type ToolContext } from './context.js';
import { tokenLimit } from './schema.js';

export function registerSessionTools(ctx: ToolContext): void {
  const { register, session } = ctx;

  register('edu_session_open', 'Open a work session (reuses the open one with the same source and title)', {
    title: z.string().min(1), source: z.string().optional(), maxTokens: tokenLimit,
  }, async ({ title, source }) => {
    const origin = source ?? 'mcp';
    // Find-or-open is not atomic; serialize it per source+title across processes so concurrent opens share one session.
    return withHostLock(ctx.brainRoot, origin, `open:${title}`, async () => {
      // Only a session in this workspace's own brain: another brain's open session (the global one) is not ours to adopt.
      const existing = (await ctx.brain.list({ kind: 'session', status: 'open-session' })).find(note => note.meta.source === origin && note.meta.title === title && session.inPrimaryBrain(note));
      if (existing) { session.current = existing.meta.id; session.openedHere.add(existing.meta.id); return `Session id: ${existing.meta.id}\nReused ${line(existing)}`; }
      const agent = ctx.clientAgent();
      const note = await ctx.brain.openSession(title, origin, agent ? { agent } : undefined);
      session.current = note.meta.id;
      session.openedHere.add(note.meta.id);
      return `Session id: ${note.meta.id}\nOpened ${line(note)}`;
    });
  });

  register('edu_session_close', 'Close a session by its exact id with a summary. Repeating the same close is a no-op; an unknown id fails', {
    id: z.string().min(1), summary: z.string(), source: z.string().optional(),
    lessons: lessonsInput.optional().describe('Up to 3 observations YOU made this session; stored as unverified candidates'),
    expected_hash: z.string().min(1).optional().describe('Hash from edu_read; refuses if the session changed since'),
    maxTokens: tokenLimit,
  }, async ({ id, summary, source, lessons, expected_hash: expectedHash }) => {
    const agent = ctx.clientAgent();
    const guard = { ...(expectedHash ? { expectedHash } : {}), ...(agent ? { by: { agent } } : {}) };
    // Read, compare and close under one lock per session id: concurrent identical closes write once.
    const text = await withHostLock(ctx.brainRoot, 'mcp-close', id, async () => {
      const current = await ctx.brain.read(id);
      // Only sessions this server opened or that live in its own brain; another workspace's session reads as unknown.
      if (!current || current.meta.kind !== 'session' || !(session.openedHere.has(current.meta.id) || session.inPrimaryBrain(current))) {
        throw new Error(`Session not found: ${id}. Close needs the exact id edu_session_open returned in this workspace.`);
      }
      if (source && current.meta.source !== source) throw new Error(`Session ${id} belongs to source ${current.meta.source ?? 'unknown'}, not ${source}; not closed`);
      if (lessons?.length) {
        const result = await closeWithLessons(ctx.brain, ctx.brainRoot, current, summary, lessons, guard);
        if (result.closedNow) await autoMaintain(ctx.brain, ctx.brainRoot);
        return result.text;
      }
      if (current.meta.status === 'closed') {
        if (current.body.trim() === summary.trim()) return `Already closed ${line(current)}`;
        throw new Error(`Session ${id} is already closed with a different summary; it was not changed`);
      }
      const note = await ctx.brain.closeSession(id, summary, guard);
      await autoMaintain(ctx.brain, ctx.brainRoot);
      return `Closed ${line(note)}`;
    });
    if (session.current === id) session.current = undefined;
    return text;
  });
}
