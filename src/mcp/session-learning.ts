import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Brain } from '../brain/index.js';
import { createId } from '../brain/store.js';
import type { Note } from '../core/contracts.js';

/**
 * Observations the host model itself noted while closing a session. Edu records them as written: it does not
 * summarize, infer or call another model, and nothing here is verified, canonical or credited as a win.
 */
export const lessonInput = z.object({
  title: z.string().trim().min(1).max(200).describe('Short name of the observation'),
  body: z.string().trim().min(1).max(2000).describe('What you observed and what to do next time, in your own words'),
  evidence: z.array(z.string().min(1).max(200)).max(10).optional()
    .describe('IDs of EXISTING brain notes, exactly as printed by edu_recall / edu_read (e.g. L-some-lesson or 2026-05-01-some-title-ab12cd34). Not file names, paths, quotes or prose; omit when there is none. An unknown id rejects the whole close'),
}).strict();
export const lessonsInput = z.array(lessonInput).max(3);
export type SessionLesson = z.output<typeof lessonInput>;

interface Journal { sessionId: string; hash: string; summary: string; lessons: SessionLesson[]; done: boolean; ids: string[] }

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const noteTag = (sessionId: string, lesson: SessionLesson) => `session-lesson:${sha(JSON.stringify([sessionId, lesson])).slice(0, 16)}`;

const payloadHash = (sessionId: string, summary: string, lessons: SessionLesson[]) => sha(JSON.stringify({ session: sessionId, summary: summary.trim(), lessons }));

/** Absent file = no journal. Anything else must be a structurally and cryptographically consistent journal of this session, or it is reported untouched. */
async function readJournal(path: string, sessionId: string): Promise<Journal | undefined> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read the session-learning journal ${path}: ${error instanceof Error ? error.message : String(error)}. Nothing was changed`);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Journal>;
    const lessons = lessonsInput.safeParse(parsed.lessons);
    if (parsed.sessionId === sessionId && typeof parsed.summary === 'string' && lessons.success && typeof parsed.done === 'boolean'
      && Array.isArray(parsed.ids) && parsed.ids.every(id => typeof id === 'string') && (!parsed.done || parsed.ids.length === lessons.data.length)
      && parsed.hash === payloadHash(sessionId, parsed.summary, lessons.data)) return { ...parsed, lessons: lessons.data } as Journal;
  } catch { /* reported below */ }
  throw new Error(`The session-learning journal ${path} is corrupt or inconsistent. Nothing was changed; inspect or remove that file to continue`);
}

/** Titles a record may carry: the original, the current 16-hex suffix, or the 6-hex suffix of earlier builds. Nothing else. */
const titlesOf = (lesson: SessionLesson, tag: string) => [lesson.title, `${lesson.title} · ${tag.slice(-16)}`, `${lesson.title} · ${tag.slice(-6)}`];

/** A tag alone proves nothing (edu_remember accepts any tag): the note must be this session's own record of this lesson. */
function isRecordOf(note: Note, sessionId: string, lesson: SessionLesson, tag: string): boolean {
  const { meta } = note;
  return meta.tier === 'transitive' && meta.kind === 'lesson' && meta.source === 'mcp' && meta.origin === `session:${sessionId}`
    && ['candidate', 'proven', 'retired'].includes(meta.status ?? '') && meta.tags.includes(tag)
    && titlesOf(lesson, tag).includes(meta.title)
    && meta.links.includes(sessionId) && (lesson.evidence ?? []).every(ref => meta.links.includes(ref))
    && note.body.startsWith(lesson.body) && note.body.includes(`closing session [[${sessionId}]]`);
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(journal), { mode: 0o600 });
  await rename(temp, path);
}

/**
 * Closes `session` and records `lessons` as candidate/inferred notes. The caller holds the per-session close lock.
 * Everything is validated before any effect; a private journal written before the close lets an exact retry finish
 * notes that failed to write after the session was already closed.
 */
export async function closeWithLessons(brain: Brain, root: string, session: Note, summary: string, input: SessionLesson[]): Promise<{ text: string; closedNow: boolean }> {
  const lessons = input.map(lesson => ({ title: lesson.title, body: lesson.body, ...(lesson.evidence?.length ? { evidence: [...new Set(lesson.evidence)] } : {}) }));
  const tags = lessons.map(lesson => noteTag(session.meta.id, lesson));
  if (new Set(tags).size !== tags.length) throw new Error('The same lesson appears twice in one close');
  for (const lesson of lessons) for (const ref of lesson.evidence ?? []) if (!await brain.read(ref)) throw new Error(`Evidence not found: ${ref}. Cite only existing note ids; nothing was closed or recorded`);

  const hash = payloadHash(session.meta.id, summary, lessons);
  const journalPath = join(root, 'state', 'session-learning', `${sha(session.meta.id).slice(0, 32)}.json`);
  const journal = await readJournal(journalPath, session.meta.id);
  const closed = session.meta.status === 'closed';
  if (closed && journal?.hash !== hash) {
    if (journal) throw new Error(`Session ${session.meta.id} is already closed with a different summary or lessons; nothing was added`);
    if (session.body.trim() === summary.trim()) throw new Error(`Session ${session.meta.id} was closed without lessons; record them explicitly with edu_remember`);
    throw new Error(`Session ${session.meta.id} is already closed with a different summary; it was not changed`);
  }
  if (!closed) {
    await writeJournal(journalPath, { sessionId: session.meta.id, hash, summary, lessons, done: false, ids: [] });
    await brain.closeSession(session.meta.id, summary);
  }

  const recorded: string[] = [];
  const created: string[] = [];
  const candidates = (await brain.list({ kind: 'lesson' })).filter(note => note.meta.tags.some(tag => tag.startsWith('session-lesson:')));
  for (const [i, lesson] of lessons.entries()) {
    const tag = tags[i]!;
    try {
      const suffixed = titlesOf(lesson, tag)[1]!;
      const existing = candidates.find(note => isRecordOf(note, session.meta.id, lesson, tag));
      if (existing) { recorded.push(existing.meta.id); continue; }
      const refs = lesson.evidence ?? [];
      const input = {
        tier: 'transitive' as const, kind: 'lesson' as const, band: 'inferred' as const, source: 'mcp', tags: ['session-lesson', tag], links: [session.meta.id, ...refs],
        body: [lesson.body, ...(refs.length ? ['', `Evidence: ${refs.map(ref => `[[${ref}]]`).join(', ')}`] : []), '', `Noted by the host model when closing session [[${session.meta.id}]]; not verified.`].join('\n'),
        provenance: { origin: `session:${session.meta.id}` },
      };
      // A lesson never overwrites another one: when the title is taken (another session, same title) the id gets a stable full-hash suffix; an occupied suffixed id is reported, never overwritten.
      const note = await brain.read(createId({ tier: 'transitive', kind: 'lesson', title: lesson.title }))
        ? await brain.write({ ...input, title: suffixed })
        : await brain.write({ ...input, title: lesson.title }).catch((error: unknown) => { if (error instanceof Error && error.message.startsWith('Note id already exists')) return brain.write({ ...input, title: suffixed }); throw error; });
      recorded.push(note.meta.id); created.push(note.meta.id);
    } catch (error) {
      throw new Error(`Session ${session.meta.id} is closed, but ${lessons.length - recorded.length} of ${lessons.length} lessons are pending (${error instanceof Error ? error.message : String(error)}). Recorded: ${recorded.join(', ') || 'none'}. Repeat the exact same edu_session_close call to finish`);
    }
  }
  if (!(closed && journal?.done && !created.length))
  await writeJournal(journalPath, { sessionId: session.meta.id, hash, summary, lessons, done: true, ids: recorded }).catch(() => undefined);
  const text = closed && !created.length
    ? `Already closed ${session.meta.id}; lessons already recorded: ${recorded.join(', ')}`
    : `Closed ${session.meta.id}; lessons recorded as candidate/inferred (not verified): ${recorded.join(', ')}`;
  return { text, closedNow: !closed };
}
