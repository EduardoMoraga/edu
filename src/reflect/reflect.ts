import { readdir, readFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { z } from 'zod';
import type { Engine, EngineRunRequest, Note } from '../core/contracts.js';
import type { Brain, NewNote } from '../brain/index.js';
import { AutomaticProposalSuppressedError } from '../brain/brain.js';
import { createId, exclusiveWrite } from '../brain/store.js';
import { withFileLock } from '../brain/lock.js';
import { listProposals } from './proposals.js';

const Item = z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict();
export const ReflectionSchema = z.object({
  lessons: z.array(Item), hypotheses: z.array(Item),
  feedback: z.array(z.object({ id: z.string().min(1), helpful: z.boolean() }).strict()),
  skillProposals: z.array(z.object({ name: z.string().min(1), rationale: z.string().min(1), diff: z.string().optional(), content: z.string().optional() }).strict().refine(value => Boolean(value.content || value.diff), 'Skill proposals require content or a diff')),
  canonicalProposals: z.array(z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict()),
}).strict();
export type ReflectionOutput = z.infer<typeof ReflectionSchema>;
const ReplaySchema = z.object({ version: z.literal(1), output: ReflectionSchema, feedbackCandidates: z.array(z.string()) }).strict();
export interface ReflectInput { brain: Brain; engine: Engine; since?: string; now?: Date; brainRoot?: string }
export interface ReflectReport { lessons: string[]; hypotheses: string[]; feedback: string[]; skillProposals: { id: string; path: string }[]; canonicalProposals: string[]; episodesRead: number; message?: string }

/** Candidate discovery must not copy the entire brain into the model request. */
export function feedbackCandidates(notes: Note[], byteLimit = 6000): { id: string; title: string }[] {
  const selected: { id: string; title: string }[] = [];
  let bytes = 2;
  for (const note of notes) {
    const candidate = { id: note.meta.id, title: note.meta.title.slice(0, 160) };
    const size = Buffer.byteLength(JSON.stringify(candidate), 'utf8') + (selected.length ? 1 : 0);
    if (bytes + size > byteLimit) continue;
    selected.push(candidate);
    bytes += size;
  }
  return selected;
}

export async function reflect({ brain, engine, since = '7d', now = new Date(), brainRoot }: ReflectInput): Promise<ReflectReport> {
  const first = (await brain.list({ tier: 'episodic' }))[0];
  const root = brainRoot ?? (first ? dirname(dirname(dirname(first.path))) : undefined);
  if (!root) return { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, message: 'Nothing to reflect yet.' };
  // Separate from the short-lived brain mutation lock: the engine may take minutes.
  return withFileLock(join(root, 'state', 'reflect.lock'), () => runReflection({ brain, engine, since, now, brainRoot: root }));
}

async function runReflection({ brain, engine, since = '7d', now = new Date(), brainRoot }: ReflectInput): Promise<ReflectReport> {
  const episodes = (await brain.list({ tier: 'episodic', kind: 'session', status: 'closed' })).filter(note => note.meta.created >= cutoff(since, now));
  if (!episodes.length) return { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, message: 'Nothing to reflect yet.' };
  const root = brainRoot ?? (episodes[0] ? dirname(dirname(dirname(episodes[0].path))) : undefined);
  const queued = root ? await reflectionQueue(root) : [];
  const sinceAt = cutoff(since, now);
  const runSummaries = root ? (await readRunSummaries(join(root, 'runs'))).filter(run => !run.at || run.at >= sinceAt) : [];
  const evidence = root ? await readEpisodeEvidence(join(root, 'runs'), sinceAt) : { episodeCount: 0, interventions: [] as EpisodeIntervention[] };
  const feedbackNotes = (await brain.list()).filter(note => note.meta.tier !== 'episodic');
  const candidates = feedbackCandidates(feedbackNotes);
  const prompt = [
    'Analyze the supplied completed episodes and run summaries. Return JSON only with this schema: {"lessons":[{"title":"...","body":"...","evidence":["note-id"]}],"hypotheses":[{"title":"...","body":"...","evidence":[]}],"feedback":[{"id":"note-id","helpful":true}],"skillProposals":[{"name":"safe-name","rationale":"...","content":"..."}],"canonicalProposals":[{"title":"...","body":"...","evidence":[]}]}.',
    'Only derive claims supported by the input. Do not claim a proposal was applied.',
    'Feedback may only name ids from Feedback candidates. Closed episodes are immutable and cannot receive feedback.',
    `Feedback candidates: ${JSON.stringify(candidates)}`,
    `Candidate listing omitted ${feedbackNotes.length - candidates.length} notes to respect its byte budget. Titles identify notes; assess usefulness only from episode evidence.`,
    `Episodes: ${JSON.stringify(episodes.map(note => ({ id: note.meta.id, title: note.meta.title, body: note.body, created: note.meta.created })))}`,
    `Run summaries: ${JSON.stringify(runSummaries)}`,
    `M-HIR by gap (episodes with an avoidable intervention / evidence packages): ${JSON.stringify(mhirByGap(evidence.interventions, evidence.episodeCount))}`,
  ].join('\n\n');
  // Closed episodes are immutable. The key ignores changing candidates/clock/queue so a partial
  // application can replay exactly the original model response, even in a fresh process.
  const episodeDigest = digest(JSON.stringify(episodes.map(note => ({ id: note.meta.id, title: note.meta.title, body: note.body, created: note.meta.created })).sort((a, b) => a.id.localeCompare(b.id))));
  const responsePath = join(root!, 'state', 'reflect-responses', `${episodeDigest}.json`);
  let replay: z.infer<typeof ReplaySchema>;
  try { replay = ReplaySchema.parse(JSON.parse(await readFile(responsePath, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    let response = '';
    const request: EngineRunRequest = { cli: engine.cli, prompt, cwd: process.cwd(), autonomy: 'readonly' };
    for await (const event of engine.run(request, 'reflect')) if (event.type === 'agent.text') response += event.text;
    replay = { version: 1, output: ReflectionSchema.parse(parseJson(response)), feedbackCandidates: candidates.map(note => note.id) };
    // Persist before applying anything. A publication error leaves all model effects unapplied.
    await exclusiveWrite(responsePath, JSON.stringify(replay));
  }
  const { output } = replay;
  const report: ReflectReport = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: episodes.length };
  const conflict = (id: string) => { report.message = [report.message, `Skipped conflicting reflection note: ${id}.`].filter(Boolean).join(' '); };
  report.lessons.push(...await writeInterventionLessons(brain, evidence.interventions, conflict));
  for (const lesson of output.lessons) {
    const note = await writeOnce(brain, noteInput(lesson, 'lesson', 'transitive'), conflict);
    if (note) report.lessons.push(note.meta.id);
  }
  for (const hypothesis of output.hypotheses) {
    const note = await writeOnce(brain, noteInput(hypothesis, 'hypothesis', 'transitive'), conflict);
    if (note) report.hypotheses.push(note.meta.id);
  }
  const eligible = new Set(replay.feedbackCandidates);
  for (const feedback of output.feedback) {
    if (!eligible.has(feedback.id) || !await brain.read(feedback.id)) {
      report.message = [report.message, `Skipped invalid feedback target: ${feedback.id}.`].filter(Boolean).join(' ');
      continue;
    }
    const eventId = `reflect:${digest(JSON.stringify([episodes.map(note => note.meta.id).sort(), feedback.id, feedback.helpful]))}`;
    try { await brain.feedback(feedback.id, feedback.helpful, eventId); }
    catch (error) {
      // A candidate may be rejected/deleted after replay was saved or after the read above.
      if (await brain.read(feedback.id)) throw error;
      report.message = [report.message, `Skipped missing feedback target: ${feedback.id}.`].filter(Boolean).join(' ');
      continue;
    }
    if (!report.feedback.includes(feedback.id)) report.feedback.push(feedback.id);
  }
  if (output.skillProposals.length && !root) throw new Error('Cannot write skill proposals: provide brainRoot or at least one episodic note.');
  for (const skill of output.skillProposals) {
    const safeName = skill.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!safeName) throw new Error('Skill proposal name must contain an alphanumeric character.');
    const prior = (await listProposals(brain, root)).find(item => item.name === safeName && item.content === (skill.content ?? '') && item.diff === skill.diff);
    if (prior) continue; // Includes accepted and rejected proposals, not only pending ones.
    const id = `skill-${safeName}-${digest(JSON.stringify([skill.content ?? '', skill.diff ?? ''])).slice(0, 16)}`;
    const path = join(root!, 'proposals', `${id}.md`);
    const metadata = { id, kind: 'skill', name: safeName, rationale: skill.rationale, content: skill.content ?? '', ...(skill.diff ? { diff: skill.diff } : {}), created: now.toISOString(), status: 'proposed' };
    await mkdir(dirname(path), { recursive: true });
    try { await exclusiveWrite(path, `---\n${stringify(metadata)}---\n`); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      conflict(id); continue;
    }
    report.skillProposals.push({ id, path });
  }
  for (const proposal of output.canonicalProposals) {
    try {
      const note = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: proposal.title, body: proposal.body, links: proposal.evidence, source: 'edu:reflect', band: 'inferred' });
      report.canonicalProposals.push(note.meta.id);
    } catch (error) {
      if (error instanceof AutomaticProposalSuppressedError) continue;
      if (!isNoteCollision(error)) throw error;
      conflict(createId({ tier: 'canonical', title: proposal.title }));
    }
  }
  // maintain owns promotion of newly proven lessons; imported proven lessons are not re-proposed.
  if (root) await consumeReflectionQueue(root, queued);
  return report;
}

async function reflectionQueue(root: string): Promise<string[]> {
  const queue = join(root, 'reflect-queue');
  let entries;
  try { entries = await readdir(queue, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name);
}

async function consumeReflectionQueue(root: string, pending: string[]): Promise<void> {
  for (const name of pending) {
    try { await unlink(join(root, 'reflect-queue', name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Replays reuse the exact persisted note; a title collision must never overwrite different evidence. */
const isNoteCollision = (error: unknown) => error instanceof Error && error.message.startsWith('Note id already exists:');
async function writeOnce(brain: Brain, input: NewNote, conflict: (id: string) => void): Promise<Note | undefined> {
  const id = createId(input);
  const same = (note: Note) => note.meta.source === input.source && note.body.trim() === input.body.trim() && note.meta.kind === input.kind && [...note.meta.links].sort().join('\n') === [...(input.links ?? [])].sort().join('\n');
  const existing = await brain.read(id);
  if (existing) {
    if (!same(existing)) { conflict(id); return undefined; }
    return existing;
  }
  try { return await brain.write(input); }
  catch (error) {
    const current = await brain.read(id);
    if (current && same(current)) return current;
    if (current || isNoteCollision(error)) { conflict(id); return undefined; }
    throw error;
  }
}

async function writeInterventionLessons(brain: Brain, interventions: EpisodeIntervention[], conflict: (id: string) => void): Promise<string[]> {
  const existingLessons = await brain.list({ tier: 'transitive', kind: 'lesson' });
  const existingKeys = new Set(existingLessons.map(note => `${note.meta.title}\n${note.meta.tags.join(',')}`));
  const created: string[] = [];
  for (const intervention of interventions.filter(event => event.avoidable)) {
    const gap = safeGap(intervention.harnessGap);
    const tag = `harness-gap:${gap}`;
    const evidenceTitle = intervention.detail ? `: ${intervention.detail.replace(/\s+/g, ' ').slice(0, 48)}` : '';
    const title = `Harness gap: ${gap} — ${intervention.action || 'human intervention'}${evidenceTitle}`;
    const key = `${title}\n${tag}`;
    if (existingKeys.has(key)) continue;
    const note = await writeOnce(brain, {
      title,
      body: `An avoidable user intervention identified a ${gap} harness gap.\n\nAction: ${intervention.action || 'Not recorded.'}${intervention.detail ? `\n\nEvidence: ${intervention.detail}` : ''}`,
      tier: 'transitive', kind: 'lesson', band: 'inferred', tags: [tag], source: 'edu:reflect',
    }, conflict);
    if (note) created.push(note.meta.id);
    existingKeys.add(key);
  }
  return created;
}

interface EpisodeIntervention {
  runId?: string;
  type?: string;
  avoidable?: boolean;
  harnessGap?: string;
  action?: string;
  detail?: string;
}

async function readEpisodeEvidence(runsDir: string, sinceAt: string): Promise<{ episodeCount: number; interventions: EpisodeIntervention[] }> {
  let entries;
  try { entries = await readdir(runsDir, { withFileTypes: true }); }
  catch { return { episodeCount: 0, interventions: [] }; }
  const directories = entries.filter(entry => entry.isDirectory());
  let episodeCount = 0;
  const interventions: EpisodeIntervention[] = [];
  for (const entry of directories) {
    const dir = join(runsDir, entry.name);
    try {
      const [taskText, outcomeText, eventText] = await Promise.all([
        readFile(join(dir, 'task.json'), 'utf8'),
        readFile(join(dir, 'outcome.json'), 'utf8'),
        readFile(join(dir, 'intervention.jsonl'), 'utf8'),
      ]);
      const task = JSON.parse(taskText) as { startedAt?: string };
      const outcome = JSON.parse(outcomeText) as { at?: string };
      const created = task.startedAt ?? outcome.at;
      if (created && created < sinceAt) continue;
      episodeCount++;
      for (const line of eventText.split(/\r?\n/).filter(Boolean)) {
        try {
          const event = JSON.parse(line) as EpisodeIntervention;
          if (event.type === 'intervention' || event.avoidable !== undefined) interventions.push({ ...event, runId: entry.name });
        } catch { /* Ignore an incomplete package line. */ }
      }
    } catch { /* Incomplete packages are not counted as evidence. */ }
  }
  return { episodeCount, interventions };
}

function mhirByGap(interventions: EpisodeIntervention[], episodeCount: number): Record<string, { episodes: number; rate: number }> {
  const grouped = new Map<string, Set<string>>();
  for (const [index, event] of interventions.entries()) {
    if (!event.avoidable) continue;
    const gap = safeGap(event.harnessGap);
    const ids = grouped.get(gap) ?? new Set<string>();
    ids.add(event.runId ?? `${event.action ?? 'intervention'}:${index}`);
    grouped.set(gap, ids);
  }
  return Object.fromEntries([...grouped].map(([gap, rows]) => [gap, { episodes: rows.size, rate: episodeCount ? rows.size / episodeCount : 0 }]));
}

function safeGap(value: string | undefined): string {
  return value && /^[a-z][a-z0-9_-]*$/.test(value) ? value : 'unknown';
}

function noteInput(item: z.infer<typeof Item>, kind: 'lesson' | 'hypothesis', tier: 'transitive'): NewNote {
  return { title: item.title, body: item.body, tier, kind, links: item.evidence, band: kind === 'hypothesis' ? 'hypothesis' : 'inferred', source: 'edu:reflect' };
}
function parseJson(text: string): unknown {
  const candidate = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? text.trim();
  try { return JSON.parse(candidate); }
  catch (error) { throw new Error(`Reflection response must be strict JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
function cutoff(since: string, now: Date): string {
  const match = /^([1-9]\d*)([dhm])$/.exec(since);
  if (!match) throw new Error(`Invalid since duration '${since}'; use a positive duration such as 7d, 12h, or 30m.`);
  const amount = Number(match[1]);
  const factor = match[2] === 'd' ? 86_400_000 : match[2] === 'h' ? 3_600_000 : 60_000;
  return new Date(now.getTime() - amount * factor).toISOString();
}
async function readRunSummaries(dir: string): Promise<{ runId: string; summary: string; at?: string }[]> {
  let files: string[];
  try { files = await readdir(dir); } catch { return []; }
  const results: { runId: string; summary: string; at?: string }[] = [];
  for (const file of files.filter(name => name.endsWith('.jsonl'))) {
    const rows = (await readFile(join(dir, file), 'utf8')).split('\n').filter(Boolean);
    for (const row of rows) {
      try { const event = JSON.parse(row); if (event.type === 'run.end') results.push({ runId: event.runId, summary: event.summary, at: event.at }); } catch { /* Ignore incomplete replay lines. */ }
    }
  }
  return results;
}
