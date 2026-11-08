/**
 * `edu dream`: batch, out-of-band consolidation over recent sessions from every host.
 *
 * Planning reads only and writes a reviewable plan (see dream-plan.ts). The deterministic mode needs no model:
 *   - new-lesson: a topic (word pair) recurring in at least `minSessions` closed sessions that no live lesson,
 *     decision or hypothesis covers, with its prevalence and the session ids as evidence;
 *   - promote-lesson: a candidate lesson that at least two distinct closed sessions reference;
 *   - archive: a candidate lesson or open hypothesis neither used nor referenced for `unusedDays`;
 *   - fix-link / add-as-of / supersede / merge-duplicates: from `edu brain lint` findings.
 * `--model` adds proposals from a model over the same packed evidence, through the engine path `edu reflect`
 * uses; a proposal citing an id that was not supplied is dropped. Applying runs only the checked proposals,
 * through the brain's lifecycle (locks, immutability rules), and backs up every file it changes.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { z } from 'zod';
import type { BrainLocation, CanonicalKind, Engine, Note, UsageStats } from '../core/contracts.js';
import { brainPath, createId, isInside, slugify, type Brain } from '../brain/index.js';
import { isClosedEpisode } from '../brain/lifecycle.js';
import { lintNotes, topicTokens, type LintFinding } from '../brain/lint.js';
import { isOperationalNote, relevantPassage } from '../brain/search.js';
import { linkTargets } from '../brain/tidy.js';
import { estimateTokens, truncateToTokens } from '../context/tokens.js';
import { DREAM_KINDS, type DreamChange, type DreamPlan, type DreamProposal, type DreamKind } from './dream-plan.js';
import { digest, locked } from './persistence.js';
import { invokeReflectionEngine, parseJson } from './reflect.js';

export const DREAM_SOURCE = 'edu:dream';
const DAY = 864e5;

export interface DreamOptions {
  now?: Date;
  /** Closed sessions from the last `days` days (default 14). */
  days?: number;
  /** Lint threshold for time-sensitive claims (default 90). */
  staleDays?: number;
  /** A candidate lesson or open hypothesis unused for this long is proposed for archive (default 90). */
  unusedDays?: number;
  /** Sessions a topic must recur in before it becomes a new-lesson proposal (default 3). */
  minSessions?: number;
  /** Where usage comes from; defaults to the note's frontmatter (a local ledger can be plugged in). */
  usageOf?: (note: Note) => UsageStats | undefined;
  /** With an engine: also ask the model, over the same evidence. */
  engine?: Engine;
  budgetTokens?: number;
  maxEpisodes?: number;
}

const iso = (date: Date) => date.toISOString();
const day = (date: Date) => iso(date).slice(0, 10);
const proposalId = (kind: DreamKind, changes: DreamChange[]) => `P-${digest({ kind, changes }).slice(0, 8)}`;
const editable = (note: Note) => !isClosedEpisode(note.meta) && !(note.meta.tier === 'canonical' && (note.meta.status === 'accepted' || note.meta.status === 'superseded'));

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}

interface Evidence { sessions: Note[]; all: Note[]; inPrimary: (note: Note) => boolean; byId: Map<string, Note> }

/** Every closed session that references a note: by frontmatter link, by [[wikilink]], or cited by the note itself. */
function supporters(note: Note, sessions: Note[]): Note[] {
  const names = new Set([note.meta.id, ...(note.meta.aliases ?? [])].map(name => name.toLowerCase()));
  return sessions.filter(session => note.meta.links.includes(session.meta.id) || session.meta.links.includes(note.meta.id)
    || linkTargets(session.body).some(target => names.has(target.toLowerCase())));
}

function recurringTopics(ev: Evidence, recent: Note[], minSessions: number): DreamProposal[] {
  const pairs = new Map<string, Set<string>>();
  const streams = new Map<string, string[]>();
  for (const session of recent) {
    const tokens = topicTokens(session.body);
    streams.set(session.meta.id, tokens);
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i - 1] === tokens[i]) continue;
      const pair = `${tokens[i - 1]} ${tokens[i]}`;
      pairs.set(pair, (pairs.get(pair) ?? new Set()).add(session.meta.id));
    }
  }
  // Boilerplate every session repeats ("session closed by hook") is not a topic.
  const ubiquitous = (count: number) => recent.length >= 10 && count > recent.length * 0.8;
  const covers = ev.all.filter(note => isOperationalNote(note) && ((note.meta.tier === 'transitive' && ['lesson', 'decision', 'hypothesis'].includes(note.meta.kind ?? '')) || note.meta.tier === 'canonical'))
    .map(note => new Set(topicTokens(`${note.meta.title}\n${note.body}`)));
  const groups = new Map<string, { sessions: string[]; words: Set<string> }>();
  for (const [pair, ids] of pairs) {
    if (ids.size < minSessions || ubiquitous(ids.size)) continue;
    const words = pair.split(' ');
    if (covers.some(tokens => words.every(word => tokens.has(word)))) continue;
    const sessions = [...ids].sort();
    const key = sessions.join('\n');
    const group = groups.get(key) ?? { sessions, words: new Set<string>() };
    for (const word of words) group.words.add(word);
    groups.set(key, group);
  }
  const chosen: { sessions: string[]; label: string; words: Set<string> }[] = [];
  for (const group of [...groups.values()].sort((a, b) => b.sessions.length - a.sessions.length || b.words.size - a.words.size || a.sessions[0]!.localeCompare(b.sessions[0]!))) {
    if (chosen.some(topic => [...group.words].every(word => topic.words.has(word)))) continue;
    // Label in the order the words first appear in the first session.
    const order = streams.get(group.sessions[0]!) ?? [];
    const label = [...group.words].sort((a, b) => order.indexOf(a) - order.indexOf(b)).slice(0, 6).join(' ');
    chosen.push({ sessions: group.sessions, label, words: group.words });
    if (chosen.length >= 8) break;
  }
  return chosen.map(topic => {
    const notes = topic.sessions.map(id => ev.byId.get(id)!);
    const hosts = [...new Set(notes.map(note => note.meta.source ?? 'unknown'))].sort();
    const body = [
      `"${topic.label}" came up in ${notes.length} sessions (${hosts.join(', ')}) and no lesson or decision covered it.`, '',
      ...notes.map(note => `- [[${note.meta.id}]] (${note.meta.source ?? 'unknown'}, ${(note.meta.updated ?? note.meta.created).slice(0, 10)}): ${JSON.stringify(relevantPassage(note.body, topic.label, 200).replace(/\s+/g, ' '))}`),
      '', 'Candidate written by edu dream from recurrence alone: confirm what the lesson is, or retire it.',
    ].join('\n');
    const changes: DreamChange[] = [{ op: 'write-lesson', title: `Recurring topic: ${topic.label}`, body, links: topic.sessions, tags: ['dream'] }];
    return { id: proposalId('new-lesson', changes), kind: 'new-lesson' as const, title: `Recurring: ${topic.label}`, prevalence: notes.length, evidence: topic.sessions, rationale: `Appears in ${notes.length} closed sessions from ${hosts.join(', ')} without a matching lesson, decision or hypothesis.`, changes, origin: 'heuristic' as const, checked: true };
  });
}

function fromLint(ev: Evidence, findings: LintFinding[], now: Date): DreamProposal[] {
  const proposals: DreamProposal[] = [];
  const push = (kind: DreamKind, title: string, evidence: string[], rationale: string, changes: DreamChange[], checked: boolean, prevalence = evidence.length) =>
    proposals.push({ id: proposalId(kind, changes), kind, title, prevalence, evidence: [...new Set(evidence)], rationale, changes, origin: 'heuristic', checked });
  const marker = `(as of ${day(now)})`;
  for (const finding of findings) {
    const notes = finding.ids.map(id => ev.byId.get(id)).filter((note): note is Note => Boolean(note));
    if (finding.kind === 'missing-page' && finding.target) {
      const want = slugify(finding.target);
      const exact = ev.all.filter(note => ev.inPrimary(note) && editable(note) && note.meta.tier !== 'episodic'
        && [slugify(note.meta.title), slugify(note.meta.id), slugify(note.meta.id.replace(/^[A-Z]-/, ''))].includes(want));
      const close = exact.length ? exact : want.length >= 8 ? ev.all.filter(note => ev.inPrimary(note) && editable(note) && note.meta.tier !== 'episodic' && levenshtein(slugify(note.meta.title), want, 2) <= 2) : [];
      if (close.length !== 1) continue;
      const target = close[0]!;
      push('fix-link', `[[${finding.target}]] → ${target.meta.id}`, [...finding.ids, target.meta.id], `${finding.ids.length} note(s) link [[${finding.target}]], which resolves to nothing; "${target.meta.title}" is the one note with that name.`, [{ op: 'add-alias', id: target.meta.id, alias: finding.target }], true, finding.ids.length);
    }
    if (finding.kind === 'stale-claim' && notes[0] && ev.inPrimary(notes[0])) {
      const note = notes[0];
      const why = `Time-sensitive (${finding.evidence?.join(', ')}) and unchanged since ${note.meta.created.slice(0, 10)}. Tick only after checking it still holds today.`;
      const body = `${note.body.trimEnd()}\n\nStill holds ${marker}.`;
      const title = `${note.meta.title} ${marker}`;
      if (note.meta.kind === 'decision') push('add-as-of', `${note.meta.title}: add ${marker}`, [note.meta.id], why, [{ op: 'write-decision', title, body, supersedes: note.meta.id, links: [...new Set([note.meta.id, ...note.meta.links])] }], false, 1);
      else if (note.meta.tier === 'canonical') push('add-as-of', `${note.meta.title}: add ${marker}`, [note.meta.id], why, [{ op: 'propose-canonical', kind: (note.meta.kind ?? 'domain') as CanonicalKind, title, body, supersedes: note.meta.id, links: [...new Set([note.meta.id, ...note.meta.links])] }], false, 1);
    }
    if (finding.kind === 'contradiction' && notes.length === 2 && notes.every(note => note.meta.kind === 'decision') && ev.inPrimary(notes[0]!)) {
      const [older, newer] = notes as [Note, Note];
      push('supersede', `"${newer.meta.title}" replaces "${older.meta.title}"?`, [older.meta.id, newer.meta.id], `${finding.message} (${finding.evidence?.join('; ')}). Tick only if the newer decision is the one that stands.`,
        [{ op: 'write-decision', title: `Keep ${newer.meta.title}`, body: `[[${newer.meta.id}]] stands and replaces [[${older.meta.id}]].\n\nOpposing signals found by edu dream: ${finding.evidence?.join('; ')}.`, supersedes: older.meta.id, links: [newer.meta.id, older.meta.id] }], false, 2);
    }
    if (finding.kind === 'duplicate' && notes.length === 2 && ev.inPrimary(notes[1]!)) {
      const [keep, drop] = notes as [Note, Note];
      const change: DreamChange | undefined = drop.meta.kind === 'lesson' && (drop.meta.status === 'candidate' || drop.meta.status === 'proven') ? { op: 'set-status', id: drop.meta.id, from: drop.meta.status, to: 'retired', superseded_by: keep.meta.id }
        : drop.meta.kind === 'hypothesis' && drop.meta.status === 'open' ? { op: 'set-status', id: drop.meta.id, from: 'open', to: 'no-evidence', superseded_by: keep.meta.id }
          : drop.meta.kind === 'decision' && drop.meta.status === 'active' ? { op: 'write-decision', title: `Merge ${drop.meta.title} into ${keep.meta.id}`, body: `[[${drop.meta.id}]] duplicates [[${keep.meta.id}]] (${finding.evidence?.join(', ')}); [[${keep.meta.id}]] stands.`, supersedes: drop.meta.id, links: [keep.meta.id, drop.meta.id] }
            : undefined;
      if (change) push('merge-duplicates', `Merge ${drop.meta.id} into ${keep.meta.id}`, [keep.meta.id, drop.meta.id], `${finding.message}. ${keep.meta.id} is older and is kept.`, [change], finding.severity === 'error', 2);
    }
  }
  return proposals;
}

function lifecycleProposals(ev: Evidence, opts: Required<Pick<DreamOptions, 'unusedDays'>> & { now: Date; usageOf: (note: Note) => UsageStats | undefined }): DreamProposal[] {
  const proposals: DreamProposal[] = [];
  const unusedSince = opts.now.getTime() - opts.unusedDays * DAY;
  for (const note of ev.all) {
    if (!ev.inPrimary(note) || note.meta.tier !== 'transitive') continue;
    const support = supporters(note, ev.sessions);
    if (note.meta.kind === 'lesson' && note.meta.status === 'candidate') {
      const usage = opts.usageOf(note);
      if (support.length >= 2 && !(usage && ((usage.verifiedLosses ?? 0) > 0 || usage.losses > usage.wins))) {
        const ids = support.map(session => session.meta.id).sort();
        const hosts = [...new Set(support.map(session => session.meta.source ?? 'unknown'))].sort();
        const changes: DreamChange[] = [{ op: 'set-status', id: note.meta.id, from: 'candidate', to: 'proven' }];
        proposals.push({ id: proposalId('promote-lesson', changes), kind: 'promote-lesson', title: `Promote: ${note.meta.title}`, prevalence: ids.length, evidence: [note.meta.id, ...ids], rationale: `${ids.length} distinct closed sessions (${hosts.join(', ')}) reference it. Ticking it is your confirmation: no verified outcome was recorded.`, changes, origin: 'heuristic', checked: false });
        continue;
      }
    }
    const archive = note.meta.kind === 'lesson' && note.meta.status === 'candidate' ? 'retired' : note.meta.kind === 'hypothesis' && note.meta.status === 'open' ? 'no-evidence' : undefined;
    if (!archive || Date.parse(note.meta.created) > unusedSince) continue;
    const lastUsed = Date.parse(opts.usageOf(note)?.lastUsed ?? '');
    if (Number.isFinite(lastUsed) && lastUsed > unusedSince) continue;
    if (support.some(session => Date.parse(session.meta.updated ?? session.meta.created) > unusedSince)) continue;
    const changes: DreamChange[] = [{ op: 'set-status', id: note.meta.id, from: note.meta.status!, to: archive }];
    proposals.push({ id: proposalId('archive', changes), kind: 'archive', title: `Archive: ${note.meta.title}`, prevalence: 0, evidence: [note.meta.id], rationale: `Not used${Number.isFinite(lastUsed) ? ` since ${new Date(lastUsed).toISOString().slice(0, 10)}` : ' since it was written'} and no session referenced it in ${opts.unusedDays} days. The file stays; only its status changes.`, changes, origin: 'heuristic', checked: true });
  }
  return proposals;
}

const ModelItem = z.object({
  kind: z.enum(DREAM_KINDS), title: z.string().min(1), body: z.string().optional(), rationale: z.string().min(1),
  evidence: z.array(z.string()).min(1), targets: z.array(z.string()).optional(), alias: z.string().optional(),
}).strict();
const ModelOutput = z.object({ proposals: z.array(z.unknown()) }).strict();

interface PromptNote { id: string; title: string; kind?: string; status?: string; source?: string; body: string; updated: string; truncated?: boolean }

/** Turns one validated model item into a proposal with exact changes, or the reason it was dropped. */
function fromModel(item: z.infer<typeof ModelItem>, ev: Evidence, supplied: Set<string>, now: Date): DreamProposal | string {
  const unknown = [...item.evidence, ...(item.targets ?? [])].filter(id => !supplied.has(id));
  if (unknown.length) return `${item.title}: cites ids not in the supplied evidence (${unknown.join(', ')})`;
  const target = item.targets?.[0] ? ev.byId.get(item.targets[0]) : undefined;
  const local = target && ev.inPrimary(target) ? target : undefined;
  const rationale = item.rationale;
  const changes: DreamChange[] | string = (() => {
    switch (item.kind) {
      case 'new-lesson':
        if (!item.body?.trim()) return 'new-lesson needs a body';
        if (!item.evidence.some(id => ev.byId.get(id)?.meta.tier === 'episodic')) return 'new-lesson must cite at least one session';
        return [{ op: 'write-lesson', title: item.title, body: item.body, links: [...new Set(item.evidence)].sort(), tags: ['dream'] }];
      case 'promote-lesson':
        return local?.meta.kind === 'lesson' && local.meta.status === 'candidate' ? [{ op: 'set-status', id: local.meta.id, from: 'candidate', to: 'proven' }] : 'promote-lesson needs a candidate lesson as target';
      case 'archive':
        if (local?.meta.kind === 'lesson' && local.meta.status === 'candidate') return [{ op: 'set-status', id: local.meta.id, from: 'candidate', to: 'retired' }];
        if (local?.meta.kind === 'hypothesis' && local.meta.status === 'open') return [{ op: 'set-status', id: local.meta.id, from: 'open', to: 'no-evidence' }];
        return 'archive needs a candidate lesson or open hypothesis as target';
      case 'supersede':
      case 'add-as-of': {
        const body = item.body?.trim() ? item.body : item.kind === 'add-as-of' && local ? `${local.body.trimEnd()}\n\nStill holds (as of ${day(now)}).` : '';
        if (!body) return `${item.kind} needs a body`;
        if (local?.meta.kind === 'decision' && local.meta.status === 'active') return [{ op: 'write-decision', title: item.title, body, supersedes: local.meta.id, links: [...new Set([local.meta.id, ...item.evidence])].sort() }];
        if (local?.meta.tier === 'canonical' && local.meta.status === 'accepted') return [{ op: 'propose-canonical', kind: (local.meta.kind ?? 'domain') as CanonicalKind, title: item.title, body, supersedes: local.meta.id, links: [...new Set([local.meta.id, ...item.evidence])].sort() }];
        return `${item.kind} needs an active decision or accepted canonical note as target`;
      }
      case 'merge-duplicates': {
        const keep = item.targets?.[0] ? ev.byId.get(item.targets[0]) : undefined;
        const drop = item.targets?.[1] ? ev.byId.get(item.targets[1]) : undefined;
        if (!keep || !drop || keep === drop || !ev.inPrimary(drop)) return 'merge-duplicates needs [keep, drop] targets';
        if (drop.meta.kind === 'lesson' && (drop.meta.status === 'candidate' || drop.meta.status === 'proven')) return [{ op: 'set-status', id: drop.meta.id, from: drop.meta.status, to: 'retired', superseded_by: keep.meta.id }];
        if (drop.meta.kind === 'hypothesis' && drop.meta.status === 'open') return [{ op: 'set-status', id: drop.meta.id, from: 'open', to: 'no-evidence', superseded_by: keep.meta.id }];
        return 'merge-duplicates can only retire a lesson or close a hypothesis';
      }
      case 'fix-link':
        if (!local || !editable(local) || !item.alias?.trim()) return 'fix-link needs an editable target and an alias';
        return [{ op: 'add-alias', id: local.meta.id, alias: item.alias.trim() }];
    }
  })();
  if (typeof changes === 'string') return `${item.title}: ${changes}`;
  const evidence = [...new Set([...item.evidence, ...(item.targets ?? [])])];
  return { id: proposalId(item.kind, changes), kind: item.kind, title: item.title, prevalence: evidence.filter(id => ev.byId.get(id)?.meta.tier === 'episodic').length, evidence, rationale, changes, origin: 'model', checked: item.kind === 'new-lesson' || item.kind === 'fix-link' || item.kind === 'archive' };
}

async function askModel(engine: Engine, root: string, ev: Evidence, recent: Note[], findings: LintFinding[], heuristic: DreamProposal[], opts: { budgetTokens: number; maxEpisodes: number; now: Date }): Promise<{ proposals: DreamProposal[]; model: NonNullable<DreamPlan['model']> }> {
  const sessions: PromptNote[] = [];
  const targets: PromptNote[] = [];
  const lint: { kind: string; ids: string[]; message: string }[] = [];
  const render = () => [
    'You consolidate an agent memory offline ("dreaming"). From the supplied closed sessions, memory notes and lint findings, propose changes. Return JSON only: {"proposals":[{"kind":"new-lesson|promote-lesson|supersede|merge-duplicates|archive|fix-link|add-as-of","title":"...","body":"...","rationale":"...","evidence":["supplied-id"],"targets":["supplied-id"],"alias":"..."}]}',
    'Rules: cite only supplied ids; a pattern needs several independent sessions; new-lesson needs a body and session evidence; promote-lesson/archive/add-as-of/supersede/fix-link take the note to change as targets[0]; merge-duplicates takes [keep, drop]; fix-link needs the alias to add. Truncated notes are incomplete. Propose nothing you cannot support.',
    `Sessions: ${JSON.stringify(sessions)}`,
    `Memory notes: ${JSON.stringify(targets)}`,
    `Lint findings: ${JSON.stringify(lint)}`,
    `Already proposed (do not repeat): ${JSON.stringify(heuristic.map(p => ({ kind: p.kind, title: p.title })))}`,
  ].join('\n\n');
  // Same packing as edu reflect: serialize, measure the full request, shrink a body before dropping a note.
  const supply = (note: Note, destination: PromptNote[], limit: number) => {
    for (const bodyBudget of [512, 256, 128, 64]) {
      const title = truncateToTokens(note.meta.title, 64);
      const body = truncateToTokens(note.body, bodyBudget);
      destination.push({ id: note.meta.id, title, kind: note.meta.kind, status: note.meta.status, ...(note.meta.source ? { source: note.meta.source } : {}), body, updated: note.meta.updated ?? note.meta.created, ...(body !== note.body || title !== note.meta.title ? { truncated: true } : {}) });
      if (estimateTokens(render()) <= limit) return true;
      destination.pop();
    }
    return false;
  };
  for (const session of recent.slice(0, opts.maxEpisodes)) supply(session, sessions, Math.floor(opts.budgetTokens * 0.6));
  const relevant = new Set(findings.flatMap(finding => finding.ids));
  const memory = ev.all.filter(note => note.meta.tier !== 'episodic' && isOperationalNote(note))
    .sort((a, b) => Number(relevant.has(b.meta.id)) - Number(relevant.has(a.meta.id)) || (b.meta.updated ?? b.meta.created).localeCompare(a.meta.updated ?? a.meta.created));
  for (const note of memory.slice(0, 40)) supply(note, targets, Math.floor(opts.budgetTokens * 0.9));
  for (const finding of findings.slice(0, 40)) {
    lint.push({ kind: finding.kind, ids: finding.ids, message: truncateToTokens(finding.message, 64) });
    if (estimateTokens(render()) > opts.budgetTokens) { lint.pop(); break; }
  }
  const prompt = render();
  const promptTokens = estimateTokens(prompt);
  const model = { cli: engine.cli, promptTokens, proposed: 0, dropped: [] as string[], deferred: recent.length - sessions.length };
  if (!sessions.length) return { proposals: [], model: { ...model, dropped: ['no session fits the prompt budget; the model was not called'] } };
  if (promptTokens > opts.budgetTokens) throw new Error('Dream prompt exceeds budgetTokens.');
  const response = await invokeReflectionEngine(engine, prompt, { budgetTokens: opts.budgetTokens, measurementPath: join(root, '.reflection-results', `dream-${digest(prompt)}.usage.jsonl`), agentId: 'dream' });
  const output = ModelOutput.parse(parseJson(response));
  // Validate against what was actually supplied, not what exists: the model never saw the rest.
  const supplied = new Set([...sessions, ...targets].map(note => note.id));
  const proposals: DreamProposal[] = [];
  model.proposed = output.proposals.length;
  for (const raw of output.proposals) {
    const item = ModelItem.safeParse(raw);
    if (!item.success) { model.dropped.push(`malformed proposal: ${item.error.issues[0]?.message ?? 'invalid'}`); continue; }
    const result = fromModel(item.data, ev, supplied, opts.now);
    if (typeof result === 'string') model.dropped.push(result);
    else proposals.push(result);
  }
  return { proposals, model };
}

/** Read-only: builds the dream plan for the primary brain from every visible note and session. */
export async function planDream(brain: Brain, primary: BrainLocation, opts: DreamOptions = {}): Promise<DreamPlan> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 14;
  const minSessions = opts.minSessions ?? 3;
  for (const [name, value] of Object.entries({ days, minSessions, staleDays: opts.staleDays ?? 90, unusedDays: opts.unusedDays ?? 90 })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Dream ${name} must be a positive integer.`);
  }
  const root = brainPath(primary);
  const all = await brain.list();
  const sessions = all.filter(note => note.meta.tier === 'episodic' && note.meta.kind === 'session' && note.meta.status === 'closed' && !['edu:reject', 'edu:reflect', DREAM_SOURCE].includes(note.meta.source ?? ''));
  const since = iso(new Date(now.getTime() - days * DAY));
  const recent = sessions.filter(note => (note.meta.updated ?? note.meta.created) >= since && note.body.trim())
    .sort((a, b) => (b.meta.updated ?? b.meta.created).localeCompare(a.meta.updated ?? a.meta.created) || a.meta.id.localeCompare(b.meta.id));
  const ev: Evidence = { sessions, all, inPrimary: note => isInside(root, note.path), byId: new Map(all.map(note => [note.meta.id, note])) };
  const report = lintNotes(all, { now, staleDays: opts.staleDays ?? 90, root });
  const heuristic = [
    ...recurringTopics(ev, recent, minSessions),
    ...lifecycleProposals(ev, { now, unusedDays: opts.unusedDays ?? 90, usageOf: opts.usageOf ?? (note => note.meta.usage) }),
    ...fromLint(ev, report.findings, now),
  ];
  const hosts: Record<string, number> = {};
  for (const session of recent) hosts[session.meta.source ?? 'unknown'] = (hosts[session.meta.source ?? 'unknown'] ?? 0) + 1;
  const plan: DreamPlan = { version: 1, generated: iso(now), brain: root, days, sessions: recent.length, hosts, proposals: heuristic, findings: report.findings };
  if (!opts.engine) return dedupe(plan);
  const budgetTokens = opts.budgetTokens ?? 8000, maxEpisodes = opts.maxEpisodes ?? 40;
  if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 1 || !Number.isSafeInteger(maxEpisodes) || maxEpisodes < 1) throw new Error('Dream budgetTokens and maxEpisodes must be positive safe integers.');
  const asked = await askModel(opts.engine, primary.root, ev, recent, report.findings, heuristic, { budgetTokens, maxEpisodes, now });
  return dedupe({ ...plan, proposals: [...heuristic, ...asked.proposals], model: asked.model });
}

/** Two proposals with the same exact changes are one proposal (the heuristic one wins). */
function dedupe(plan: DreamPlan): DreamPlan {
  const seen = new Set<string>();
  return { ...plan, proposals: plan.proposals.filter(p => !seen.has(p.id) && Boolean(seen.add(p.id))) };
}

export interface DreamApplyResult { backup: string; applied: string[]; written: string[]; skipped: { id: string; reason: string }[]; unchecked: number }

/** Applies the checked, not yet applied proposals of a saved (reviewed) plan; marks them applied in the plan. */
export async function applyDream(brain: Brain, primary: BrainLocation, plan: DreamPlan, opts: { now?: Date } = {}): Promise<{ result: DreamApplyResult; plan: DreamPlan }> {
  const root = brainPath(primary);
  if (plan.brain !== root) throw new Error(`The dream plan was made for ${plan.brain}, not ${root}. Run edu dream again.`);
  const now = opts.now ?? new Date();
  const backup = join(primary.root, 'backups', `dream-${iso(now).replace(/[:.]/g, '-')}`);
  const result: DreamApplyResult = { backup, applied: [], written: [], skipped: [], unchecked: plan.proposals.filter(p => !p.checked && !p.applied).length };
  const save = async (note: Note) => {
    const target = join(backup, relative(root, note.path));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(note.path, target);
  };
  const local = async (id: string) => { const note = await brain.read(id); return note && isInside(root, note.path) ? note : undefined; };
  /** Checks a change still applies; returns why not. Nothing is written until every change of a proposal passes. */
  const check = async (change: DreamChange): Promise<string | undefined> => {
    switch (change.op) {
      case 'write-lesson': return (await brain.read(createId({ tier: 'transitive', kind: 'lesson', title: change.title }))) ? `a lesson titled "${change.title}" already exists` : undefined;
      case 'set-status': { const note = await local(change.id); return !note ? `${change.id} not found in this brain` : note.meta.status !== change.from ? `${change.id} is ${note.meta.status}, not ${change.from}` : undefined; }
      case 'write-decision': { const old = await brain.read(change.supersedes); return old?.meta.kind !== 'decision' || old.meta.status !== 'active' ? `${change.supersedes} is no longer an active decision` : (await brain.read(createId({ tier: 'transitive', kind: 'decision', title: change.title }))) ? `a decision titled "${change.title}" already exists` : undefined; }
      case 'propose-canonical': { const old = await brain.read(change.supersedes); return old?.meta.tier !== 'canonical' || old.meta.status !== 'accepted' ? `${change.supersedes} is no longer an accepted canonical note` : (await brain.read(createId({ tier: 'canonical', kind: change.kind, title: change.title }))) ? `a canonical note titled "${change.title}" already exists` : undefined; }
      case 'add-alias': { const note = await local(change.id); return !note ? `${change.id} not found in this brain` : !editable(note) ? `${change.id} is immutable` : undefined; }
    }
  };
  const run = async (change: DreamChange) => {
    switch (change.op) {
      case 'write-lesson': result.written.push((await brain.write({ tier: 'transitive', kind: 'lesson', status: 'candidate', band: 'inferred', source: DREAM_SOURCE, title: change.title, body: change.body, links: change.links, tags: change.tags })).meta.id); return;
      case 'set-status': { const note = (await local(change.id))!; await save(note); await brain.update(change.id, { status: change.to as NonNullable<Note['meta']['status']>, ...(change.superseded_by ? { superseded_by: change.superseded_by } : {}) }); return; }
      case 'write-decision': { const old = await brain.read(change.supersedes); if (old && isInside(root, old.path)) await save(old); result.written.push((await brain.write({ tier: 'transitive', kind: 'decision', band: 'inferred', source: DREAM_SOURCE, title: change.title, body: change.body, links: change.links, supersedes: change.supersedes })).meta.id); return; }
      case 'propose-canonical': result.written.push((await brain.proposeCanonical({ tier: 'canonical', kind: change.kind, band: 'inferred', source: DREAM_SOURCE, title: change.title, body: change.body, links: change.links, supersedes: change.supersedes })).meta.id); return;
      case 'add-alias': { const note = (await local(change.id))!; const aliases = [...new Set([...(note.meta.aliases ?? []), change.alias])]; if (aliases.length === (note.meta.aliases ?? []).length) return; await save(note); await brain.update(change.id, { aliases }); return; }
    }
  };
  const outcome = await locked(primary.root, async () => {
    const proposals: DreamProposal[] = [];
    for (const proposal of plan.proposals) {
      if (!proposal.checked || proposal.applied) { proposals.push(proposal); continue; }
      const blocked = (await Promise.all(proposal.changes.map(check))).find(Boolean);
      if (blocked) { result.skipped.push({ id: proposal.id, reason: blocked }); proposals.push(proposal); continue; }
      try {
        for (const change of proposal.changes) await run(change);
        result.applied.push(proposal.id);
        proposals.push({ ...proposal, applied: iso(now) });
      } catch (error) {
        result.skipped.push({ id: proposal.id, reason: error instanceof Error ? error.message : String(error) });
        proposals.push(proposal);
      }
    }
    if (result.applied.length) await brain.rebuildIndex();
    return proposals;
  });
  if (!outcome) throw new Error('Reflection or another dream is running; try again when it finishes.');
  return { result, plan: { ...plan, proposals: outcome } };
}
