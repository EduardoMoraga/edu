import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { z } from 'zod';
import type { Engine, EngineRunRequest, Note } from '../core/contracts.js';
import { atomicWrite, type Brain, type NewNote } from '../brain/index.js';
import { estimateTokens, truncateToTokens } from '../context/tokens.js';
import { digest, locked, writeOnce } from './persistence.js';
import { acknowledge, boundedRead, cutoff, queueSnapshot, readInterventions, writeInterventions, type Intervention } from './consolidate.js';

const Item = z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict();
export const ReflectionSchema = z.object({
  lessons: z.array(Item), hypotheses: z.array(Item),
  feedback: z.array(z.object({ id: z.string().min(1), helpful: z.boolean() }).strict()),
  skillProposals: z.array(z.object({ name: z.string().min(1), rationale: z.string().min(1), diff: z.string().optional(), content: z.string().optional() }).strict().refine(value => Boolean(value.content || value.diff), 'Skill proposals require content or a diff')),
  canonicalProposals: z.array(z.object({ title: z.string().min(1), body: z.string().min(1), evidence: z.array(z.string()) }).strict()),
}).strict();
export type ReflectionOutput = z.infer<typeof ReflectionSchema>;
export interface ReflectInput { brain: Brain; engine: Engine; since?: string; now?: Date; brainRoot?: string; budgetTokens?: number; maxEpisodes?: number }
export interface ReflectReport { lessons: string[]; hypotheses: string[]; feedback: string[]; skillProposals: { id: string; path: string }[]; canonicalProposals: string[]; episodesRead: number; message?: string;
  promptTokens?: number;
  advisoryFeedback?: string[];
  omitted?: { episodes: number; targets: number; runSummaries: number; runLogFiles?: number; interventions: number };
  deferred?: string[];
  truncated?: string[];
}

export async function reflect({ brain, engine, since = '7d', now = new Date(), brainRoot, budgetTokens = 8000, maxEpisodes = 20 }: ReflectInput): Promise<ReflectReport> {
  if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 1 || !Number.isSafeInteger(maxEpisodes) || maxEpisodes < 1) throw new Error('Reflection budgetTokens and maxEpisodes must be positive safe integers.');
  const sinceAt = cutoff(since, now);
  const episodes = (await brain.list({ tier: 'episodic', kind: 'session', status: 'closed' })).filter(note => (note.meta.updated ?? note.meta.created) >= sinceAt).sort(recentFirst);
  if (!episodes.length) return { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, message: 'Nothing to reflect yet.' };
  const root = brainRoot ?? dirname(dirname(dirname(episodes[0]!.path)));
  const result = await locked(root, async () => {
    const queue = await queueSnapshot(root);
    const targets = (await brain.list()).filter(note => note.meta.tier !== 'episodic' && note.meta.source !== 'edu:reflect').sort(recentFirst);
    const suppliedEpisodes: PromptNote[] = [];
    const suppliedTargets: PromptNote[] = [];
    const runSummaries: RunSummary[] = [];
    const interventions: Intervention[] = [];
    const analyzed: typeof queue = [];
    const truncated: string[] = [];
    const render = () => [
      'Analyze the supplied completed episodes and run summaries. Return JSON only with this schema: {"lessons":[{"title":"...","body":"...","evidence":["note-id"]}],"hypotheses":[{"title":"...","body":"...","evidence":[]}],"feedback":[{"id":"note-id","helpful":true}],"skillProposals":[{"name":"safe-name","rationale":"...","content":"..."}],"canonicalProposals":[{"title":"...","body":"...","evidence":[]}]}',
      'Only derive claims supported by the supplied text; truncated notes are incomplete. Cite supplied note IDs. Feedback is advisory, not verified success. Do not claim a proposal was applied.',
      `Episodes: ${JSON.stringify(suppliedEpisodes)}`,
      `Memory targets: ${JSON.stringify(suppliedTargets)}`,
      `Run summaries: ${JSON.stringify(runSummaries)}`,
      `Structured interventions: ${JSON.stringify(interventions)}`,
      `M-HIR by gap: ${JSON.stringify(mhirByGap(interventions, analyzed.length))}`,
    ].join('\n\n');
    // Serialize first, then measure the complete request, including JSON escaping and schema.
    const supplyNote = (note: Note, destination: PromptNote[], limit: number): boolean => {
      for (const bodyBudget of [512, 256, 128, 64]) {
        const title = truncateToTokens(note.meta.title, 64);
        const body = truncateToTokens(note.body, bodyBudget);
        const cut = body !== note.body || title !== note.meta.title;
        destination.push({ id: note.meta.id, title, body, updated: note.meta.updated ?? note.meta.created, ...(cut ? { truncated: true } : {}) });
        if (estimateTokens(render()) <= limit) {
          if (cut) truncated.push(note.meta.id);
          return true;
        }
        destination.pop();
      }
      return false;
    };
    // Reserve room for targets and structured evidence; the cap also bounds selected note count.
    const queueOrder = new Map(queue.map((entry, index) => [entry.sessionId, index]));
    const candidates = [...episodes].sort((a, b) => (queueOrder.get(a.meta.id) ?? Infinity) - (queueOrder.get(b.meta.id) ?? Infinity) || recentFirst(a, b));
    for (const episode of candidates.slice(0, maxEpisodes)) supplyNote(episode, suppliedEpisodes, Math.floor(budgetTokens * 0.75));
    const selected = new Set(suppliedEpisodes.map(note => note.id));
    let omittedInterventions = 0;
    for (const entry of queue.filter(entry => selected.has(entry.sessionId))) {
      const events = await readInterventions(root, entry);
      if (!events) continue;
      interventions.push(...events); analyzed.push(entry);
      if (estimateTokens(render()) > budgetTokens) {
        interventions.splice(interventions.length - events.length, events.length);
        analyzed.pop(); omittedInterventions += events.length;
      }
    }
    for (const target of targets.slice(0, 20)) supplyNote(target, suppliedTargets, budgetTokens);
    const summaryScan = await readRunSummaries(join(root, 'runs'), sinceAt);
    const summaries = summaryScan.summaries;
    for (const summary of summaries) {
      runSummaries.push({ ...summary, summary: truncateToTokens(summary.summary, 256) });
      if (estimateTokens(render()) > budgetTokens) runSummaries.pop();
    }
    const prompt = render();
    const promptTokens = estimateTokens(prompt);
    const deferred = episodes.filter(note => !selected.has(note.meta.id)).map(note => note.meta.id);
    const accounting = { promptTokens, deferred, truncated, omitted: { episodes: deferred.length, targets: targets.length - suppliedTargets.length, runSummaries: summaryScan.omittedSummaries + summaries.length - runSummaries.length, runLogFiles: summaryScan.omittedFiles, interventions: omittedInterventions } };
    if (!suppliedEpisodes.length) return { lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [], episodesRead: 0, ...accounting, message: 'No episode fits the reflection prompt budget; nothing was sent or acknowledged.' };
    if (promptTokens > budgetTokens) throw new Error('Reflection prompt exceeds budgetTokens.');
    const suppliedIds = new Set([...selected, ...suppliedTargets.map(note => note.id)]);
    const allowed = new Map([...episodes, ...targets].filter(note => suppliedIds.has(note.meta.id)).map(note => [note.meta.id, note]));
    // Persist validated model output before writes. A failed write resumes the same output.
    const journal = join(root, '.reflection-results', `${digest(prompt)}.json`);
    let output: ReflectionOutput;
    try { output = ReflectionSchema.parse(JSON.parse(await readFile(journal, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let response = '';
      const request: EngineRunRequest = { cli: engine.cli, prompt, cwd: process.cwd(), autonomy: 'readonly' };
      if (estimateTokens(request.prompt) > budgetTokens) throw new Error('Reflection request exceeds budgetTokens.');
      for await (const event of engine.run(request, 'reflect')) if (event.type === 'agent.text') response += event.text;
      output = ReflectionSchema.parse(parseJson(response));
    }
    // Validate the ENTIRE response before any memory/proposal/feedback write.
    for (const item of [...output.lessons, ...output.hypotheses, ...output.canonicalProposals]) {
      for (const id of item.evidence) if (!allowed.has(id)) throw new Error(`Invalid reflection evidence ID: ${id}`);
    }
    for (const feedback of output.feedback) {
      const note = allowed.get(feedback.id);
      if (!note || note.meta.tier === 'episodic') throw new Error(`Invalid reflection feedback ID: ${feedback.id}`);
    }
    const skills = output.skillProposals.map(skill => {
      const name = skill.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!name || !/[a-z0-9]/.test(name)) throw new Error('Skill proposal name must contain an alphanumeric character.');
      return { ...skill, name };
    });
    await atomicWrite(journal, JSON.stringify(output));
    // Processing provenance is separate from claim evidence: no citation is invented.
    await atomicWrite(`${journal}.provenance.json`, JSON.stringify({ episodes: [...selected], targets: suppliedTargets.map(note => note.id) }));
    const report: ReflectReport = { lessons: await writeInterventions(brain, interventions), hypotheses: [], feedback: [], advisoryFeedback: [...new Set(output.feedback.map(item => item.id))], skillProposals: [], canonicalProposals: [], episodesRead: suppliedEpisodes.length, ...accounting };
    // Model opinions remain in the journal. Never call brain.feedback: a model cannot verify an outcome.
    const links = (evidence: string[]) => [...new Set(evidence)].sort();
    for (const lesson of output.lessons) report.lessons.push((await writeOnce(brain, noteInput({ ...lesson, evidence: links(lesson.evidence) }, 'lesson'))).id);
    for (const hypothesis of output.hypotheses) report.hypotheses.push((await writeOnce(brain, noteInput({ ...hypothesis, evidence: links(hypothesis.evidence) }, 'hypothesis'))).id);
    for (const skill of skills) {
      const id = `skill-${skill.name}-${digest(skill).slice(0, 24)}`;
      const path = join(root, 'proposals', `${id}.md`);
      try { await readFile(path, 'utf8'); } // Preserve accepted/rejected human decisions on retries.
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const metadata = { id, kind: 'skill', ...skill, content: skill.content ?? '', created: now.toISOString(), status: 'proposed' };
        await atomicWrite(path, `---\n${stringify(metadata)}---\n`);
        report.skillProposals.push({ id, path });
      }
    }
    for (const proposal of output.canonicalProposals) {
      const result = await writeOnce(brain, { tier: 'canonical', kind: 'standard', title: proposal.title, body: proposal.body, links: links(proposal.evidence), tags: proposal.evidence.length ? [] : ['uncited'], source: 'edu:reflect', band: 'inferred' });
      if (result.created) report.canonicalProposals.push(result.id);
    }
    for (const entry of analyzed) await acknowledge(root, entry);
    return report;
  });
  if (!result) throw new Error('Reflection is already running (or its lock requires recovery).');
  return result;
}
function mhirByGap(events: Intervention[], count: number) {
  const groups = new Map<string, Set<string>>();
  for (const event of events) {
    const ids = groups.get(event.harnessGap) ?? new Set<string>();
    ids.add(event.runId); groups.set(event.harnessGap, ids);
  }
  return Object.fromEntries([...groups].map(([gap, ids]) => [gap, { episodes: ids.size, rate: count ? ids.size / count : 0 }]));
}
function noteInput(item: z.infer<typeof Item>, kind: 'lesson' | 'hypothesis'): NewNote {
  return { title: item.title, body: item.body, tier: 'transitive', kind, links: item.evidence, tags: item.evidence.length ? [] : ['uncited'], band: kind === 'hypothesis' ? 'hypothesis' : 'inferred', source: 'edu:reflect' };
}
function parseJson(text: string): unknown {
  const candidate = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? text.trim();
  try { return JSON.parse(candidate); }
  catch (error) { throw new Error(`Reflection response must be strict JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
interface PromptNote { id: string; title: string; body: string; updated: string; truncated?: boolean }
interface RunSummary { runId: string; summary: string; at: string }
function recentFirst(a: Note, b: Note): number {
  return (b.meta.updated ?? b.meta.created).localeCompare(a.meta.updated ?? a.meta.created) || a.meta.id.localeCompare(b.meta.id);
}
async function readRunSummaries(dir: string, sinceAt: string): Promise<{ summaries: RunSummary[]; omittedFiles: number; omittedSummaries: number }> {
  let files: string[];
  try { files = await readdir(dir); } catch { return { summaries: [], omittedFiles: 0, omittedSummaries: 0 }; }
  const results: RunSummary[] = [];
  const logs = files.filter(name => name.endsWith('.jsonl')).sort();
  let omittedFiles = Math.max(0, logs.length - 20);
  // Explicit reflect is bounded too: oversized logs remain on disk, never acknowledged here.
  for (const file of logs.slice(-20)) {
    let raw: string;
    try { raw = await boundedRead(join(dir, file), 262144); } catch { omittedFiles++; continue; }
    for (const row of raw.split('\n').filter(Boolean)) {
      try {
        const event = JSON.parse(row);
        if (event.type === 'run.end' && typeof event.runId === 'string' && typeof event.summary === 'string' && typeof event.at === 'string' && event.at >= sinceAt) results.push({ runId: event.runId, summary: event.summary, at: event.at });
      } catch { /* Ignore incomplete replay lines. */ }
    }
  }
  return { summaries: results.sort((a, b) => b.at.localeCompare(a.at) || a.runId.localeCompare(b.runId)).slice(0, 20), omittedFiles, omittedSummaries: Math.max(0, results.length - 20) };
}
