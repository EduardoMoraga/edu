import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify, parse } from 'yaml';
import { z } from 'zod';
import type { Engine, EngineRunRequest } from '../core/contracts.js';
import type { Brain, NewNote } from '../brain/index.js';

const Item = z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict();
export const ReflectionSchema = z.object({
  lessons: z.array(Item), hypotheses: z.array(Item),
  feedback: z.array(z.object({ id: z.string().min(1), helpful: z.boolean() }).strict()),
  skillProposals: z.array(z.object({ name: z.string().min(1), rationale: z.string().min(1), diff: z.string().optional(), content: z.string().optional() }).strict().refine(value => Boolean(value.content || value.diff), 'Skill proposals require content or a diff')),
  canonicalProposals: z.array(z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict()),
}).strict();
export type ReflectionOutput = z.infer<typeof ReflectionSchema>;
export interface ReflectInput { brain: Brain; engine: Engine; since?: string; now?: Date; brainRoot?: string }
export interface ReflectReport { lessons: string[]; hypotheses: string[]; feedback: string[]; skillProposals: { id: string; path: string }[]; canonicalProposals: string[]; episodesRead: number }

export async function reflect({ brain, engine, since = '7d', now = new Date(), brainRoot }: ReflectInput): Promise<ReflectReport> {
  const episodes = (await brain.list({ tier: 'episodic', kind: 'session', status: 'closed' })).filter(note => note.meta.created >= cutoff(since, now));
  const root = brainRoot ?? (episodes[0] ? dirname(dirname(dirname(episodes[0].path))) : undefined);
  const sinceAt = cutoff(since, now);
  const runSummaries = root ? (await readRunSummaries(join(root, 'runs'))).filter(run => !run.at || run.at >= sinceAt) : [];
  const prompt = [
    'Analyze the supplied completed episodes and run summaries. Return JSON only with this schema: {"lessons":[{"title":"...","body":"...","evidence":["note-id"]}],"hypotheses":[{"title":"...","body":"...","evidence":[]}],"feedback":[{"id":"note-id","helpful":true}],"skillProposals":[{"name":"safe-name","rationale":"...","content":"..."}],"canonicalProposals":[{"title":"...","body":"...","evidence":[]}]}.',
    'Only derive claims supported by the input. Do not claim a proposal was applied.',
    `Episodes: ${JSON.stringify(episodes.map(note => ({ id: note.meta.id, title: note.meta.title, body: note.body, created: note.meta.created })))}`,
    `Run summaries: ${JSON.stringify(runSummaries)}`,
  ].join('\n\n');
  let response = '';
  const request: EngineRunRequest = { cli: engine.cli, prompt, cwd: process.cwd(), autonomy: 'readonly' };
  for await (const event of engine.run(request, 'reflect')) if (event.type === 'agent.text') response += event.text;
  const output = ReflectionSchema.parse(parseJson(response));
  const report: ReflectReport = { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: episodes.length };
  for (const lesson of output.lessons) {
    const note = await brain.write(noteInput(lesson, 'lesson', 'transitive'));
    report.lessons.push(note.meta.id);
  }
  for (const hypothesis of output.hypotheses) {
    const note = await brain.write(noteInput(hypothesis, 'hypothesis', 'transitive'));
    report.hypotheses.push(note.meta.id);
  }
  for (const feedback of output.feedback) { await brain.feedback(feedback.id, feedback.helpful); report.feedback.push(feedback.id); }
  if (output.skillProposals.length && !root) throw new Error('Cannot write skill proposals: provide brainRoot or at least one episodic note.');
  for (const skill of output.skillProposals) {
    const safeName = skill.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!safeName) throw new Error('Skill proposal name must contain an alphanumeric character.');
    const id = `skill-${safeName}-${randomUUID().slice(0, 8)}`;
    const path = join(root!, 'proposals', `${id}.md`);
    const metadata = { id, kind: 'skill', name: safeName, rationale: skill.rationale, content: skill.content ?? '', ...(skill.diff ? { diff: skill.diff } : {}), created: now.toISOString(), status: 'proposed' };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `---\n${stringify(metadata)}---\n`, 'utf8');
    report.skillProposals.push({ id, path });
  }
  for (const proposal of output.canonicalProposals) {
    const note = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: proposal.title, body: proposal.body, links: proposal.evidence, source: 'edu:reflect', band: 'inferred' });
    report.canonicalProposals.push(note.meta.id);
  }
  const provenLessons = await brain.list({ tier: 'transitive', kind: 'lesson', status: 'proven' });
  const existingProposals = await brain.list({ tier: 'canonical' });
  for (const lesson of provenLessons) {
    if (existingProposals.some(note => note.meta.source === 'edu:reflect' && note.meta.links.includes(lesson.meta.id))) continue;
    const note = await brain.proposeCanonical({ tier: 'canonical', kind: 'standard', title: lesson.meta.title, body: lesson.body, links: [lesson.meta.id], source: 'edu:reflect', band: lesson.meta.band ?? 'inferred' });
    report.canonicalProposals.push(note.meta.id);
  }
  return report;
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
