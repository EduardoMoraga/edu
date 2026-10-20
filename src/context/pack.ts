import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readWorkspaceSettings } from '../brain/location.js';
import type { Brain } from '../brain/index.js';
import { learnedWeight } from '../brain/index.js';
import { isOperationalNote, rankNotes, relevantPassage } from '../brain/search.js';
import type { ContextPack, ContextRequest, ContextSection, Note } from '../core/contracts.js';
import { estimateTokens, truncateToTokens } from './tokens.js';

export interface ContextOptions { eduMdPath?: string; now?: Date; trackUsage?: boolean }

function byNewest(a: Note, b: Note): number {
  return b.meta.created.localeCompare(a.meta.created) || a.meta.id.localeCompare(b.meta.id);
}

/** Use the same vocabulary/window selection as retrieval, only for notes that can fit. */
function bodyPassage(note: Note, query: string | undefined, limit: number): string {
  const passage = query ? relevantPassage(note.body, query, Math.min(480, Math.floor(limit * 3))) : note.body;
  return truncateToTokens(passage.replace(/\s+/g, ' ').trim(), limit);
}

/** "You are Albert, this workspace's agent, powered by Edu…" when `.edu/config.json` names the agent. */
export async function agentIntro(eduRoot: string): Promise<string> {
  const identity = (await readWorkspaceSettings(eduRoot)).identity;
  if (!identity) return '';
  return [
    `You are **${identity.name}**, this workspace's agent, powered by Edu. Introduce yourself as ${identity.name}.`,
    identity.role ? `Role: ${identity.role}` : '',
    identity.summary ? `Operation: ${identity.summary}` : '',
    identity.tone ? `Tone: ${identity.tone}` : '',
  ].filter(Boolean).join('\n');
}

async function identityCore(path?: string): Promise<string> {
  if (!path) return '';
  const intro = await agentIntro(dirname(path));
  try {
    const source = await readFile(path, 'utf8');
    const beforeMarker = source.split('<!-- edu:extended -->', 1)[0] ?? '';
    const protocolStart = beforeMarker.indexOf('<!-- edu:core -->');
    const protocolEnd = beforeMarker.indexOf('<!-- /edu:core -->', protocolStart);
    const core = (protocolStart >= 0
      ? beforeMarker.slice(0, protocolEnd >= 0 ? protocolEnd + '<!-- /edu:core -->'.length : protocolStart)
      : beforeMarker === source ? source.split('\n').slice(0, 40).join('\n') : beforeMarker).trim();
    return intro ? `${intro}\n\n${core}` : core;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return intro;
    throw error;
  }
}

/** Construct an ordered context pack without spending tokens on notes that are not included. */
async function assembleContext(brain: Brain, req: ContextRequest, opts: ContextOptions, trackUsage: boolean): Promise<ContextPack> {
  const budget = Number.isFinite(req.budgetTokens) ? Math.max(0, Math.floor(req.budgetTokens)) : 0;
  const now = opts.now ?? new Date();
  const query = req.query?.trim();
  const allNotes = await brain.list();
  const notes = allNotes.filter(isOperationalNote);
  const sections: ContextSection[] = [];
  const deferred: string[] = [];
  const deferredIds = new Set<string>();
  const included = new Set<string>();
  const fullText = () => sections.map(section => section.text).join('\n\n');
  const defer = (note: Note) => {
    if (!included.has(note.meta.id) && !deferredIds.has(note.meta.id)) { deferredIds.add(note.meta.id); deferred.push(note.meta.id); }
  };
  const add = (title: string, line: string, note?: Note, sectionBudget = budget): boolean => {
    const existing = sections.find(section => section.title === title);
    const body = existing ? `${existing.text}\n${line}` : `## ${title}\n${line}`;
    const prospective = sections.map(section => section === existing ? body : section.text);
    if (!existing) prospective.push(body);
    if (estimateTokens(prospective.join('\n\n')) > budget || estimateTokens(body) > sectionBudget) {
      if (note) defer(note);
      return false;
    }
    if (existing) {
      existing.text = body;
      existing.tokens = estimateTokens(body);
      if (note) existing.noteIds.push(note.meta.id);
    } else sections.push({ title, text: body, tokens: estimateTokens(body), noteIds: note ? [note.meta.id] : [] });
    if (note) included.add(note.meta.id);
    return true;
  };

  // Check metadata and section overhead before inspecting a potentially large body.
  const bodyBudget = (title: string, prefix: string, sectionBudget = budget): number => {
    const existing = sections.find(section => section.title === title);
    const body = `${existing?.text ?? `## ${title}`}\n${prefix}`;
    const prospective = sections.map(section => section === existing ? body : section.text);
    if (!existing) prospective.push(body);
    return Math.max(0, Math.min(budget - estimateTokens(prospective.join('\n\n')),
      sectionBudget - estimateTokens(body)) - 1);
  };
  const addPassage = (title: string, prefix: string, note: Note, limit = 120, sectionBudget = budget) => {
    const available = bodyBudget(title, prefix, sectionBudget);
    if (available < 12) { defer(note); return; }
    add(title, `${prefix}${bodyPassage(note, query, Math.min(limit, available))}`, note, sectionBudget);
  };

  const identity = await identityCore(opts.eduMdPath ?? join(process.cwd(), '.edu', 'EDU.md'));
  if (identity) {
    const protocolStart = identity.indexOf('<!-- edu:core -->');
    const hasProtocol = protocolStart >= 0 && identity.includes('<!-- /edu:core -->');
    // An explicit protocol is atomic: retain its safety/session rules or omit it whole.
    if (!hasProtocol || !add('Identity core', identity)) {
      const allowance = Math.min(budget, Math.max(32, Math.min(160, Math.floor(budget * 0.25))));
      const minimal = hasProtocol ? identity.slice(0, protocolStart).trim() : identity;
      const clipped = truncateToTokens(minimal, allowance - estimateTokens('## Identity core\n'));
      if (clipped) add('Identity core', clipped);
    }
  }

  // Reserve a bounded share for accepted profile/preferences without starving task rules.
  const essentialKinds = new Set(['person', 'preference', 'standard', 'identity']);
  const essentials = notes.filter(note => note.meta.tier === 'canonical' && note.meta.status === 'accepted' && essentialKinds.has(String(note.meta.kind)))
    .sort((a, b) => Number(b.meta.kind === 'person') - Number(a.meta.kind === 'person') || a.meta.id.localeCompare(b.meta.id));
  for (const note of essentials) {
    addPassage('Who and how', `- ${note.meta.title}: `, note, 90, Math.floor(budget * 0.25));
  }

  const addActiveWork = () => {
    const pending = notes.filter(note => note.meta.kind === 'commitment' && (note.meta.status === 'pending' || note.meta.status === 'overdue'))
      .sort((a, b) => (a.meta.due ?? '9999').localeCompare(b.meta.due ?? '9999') || a.meta.id.localeCompare(b.meta.id));
    const hypotheses = notes.filter(note => note.meta.kind === 'hypothesis' && note.meta.status === 'open').sort(byNewest);
    for (const note of [...pending, ...hypotheses]) {
      const detail = note.meta.kind === 'commitment' ? `due ${note.meta.due ?? 'unspecified'}` : `band ${note.meta.band ?? 'hypothesis'}`;
      add('Active commitments & open hypotheses', `- ${note.meta.title} (${detail})`, note);
    }
  };
  if (!query) addActiveWork();

  const decisions = notes.filter(note => note.meta.kind === 'decision' && note.meta.status === 'active');
  const lessons = notes.filter(note => note.meta.kind === 'lesson' && (note.meta.status === 'proven' || note.meta.status === 'candidate'));
  const candidates = [...decisions, ...lessons];
  const ordered = query
    ? rankNotes(query, candidates, now, candidates.length, { includePassages: false })
      .sort((a, b) => b.score - a.score || Number(b.note.meta.status === 'proven') - Number(a.note.meta.status === 'proven'))
      .map(hit => hit.note)
    : candidates.sort((a, b) => Number(b.meta.kind === 'decision') - Number(a.meta.kind === 'decision')
      || Number(b.meta.status === 'proven') - Number(a.meta.status === 'proven')
      || learnedWeight(b.meta.usage, now) - learnedWeight(a.meta.usage, now)
      || byNewest(a, b));
  const counts = new Map<string, number>();
  for (const note of ordered) {
    const group = note.meta.kind === 'decision' ? 'decision' : note.meta.status ?? 'candidate';
    const count = counts.get(group) ?? 0;
    if (!query && count >= (group === 'candidate' ? 3 : 8)) { defer(note); continue; }
    counts.set(group, count + 1);
    const title = note.meta.kind === 'decision' ? 'Active decisions' : 'Proven lessons';
    const status = note.meta.kind === 'lesson' ? `${note.meta.status}; ${note.meta.band ?? 'inferred'}` : note.meta.status;
    addPassage(title, `- [[${note.meta.id}]] ${note.meta.title} (${status}): `, note);
  }

  if (query) addActiveWork();

  if (req.query) {
    const canonical = notes.filter(note => note.meta.tier === 'canonical' && note.meta.status === 'accepted');
    for (const hit of rankNotes(req.query, canonical, now, canonical.length, { includePassages: false })) {
      if (included.has(hit.note.meta.id)) continue;
      addPassage('Canonical hits', `- [[${hit.note.meta.id}]] ${hit.note.meta.title} (${hit.note.meta.status}): `, hit.note);
    }
  }

  for (const note of notes.filter(note => note.meta.tier === 'episodic' && note.meta.status !== 'open-session').sort(byNewest).slice(0, 3)) {
    if (bodyBudget('Last 3 episodes', `- ${note.meta.title}: `) < 12) { defer(note); continue; }
    const summary = note.body.split(/\n/, 1)[0]?.trim() ?? '';
    add('Last 3 episodes', `- ${note.meta.title}${summary ? `: ${truncateToTokens(summary, 50)}` : ''}`, note);
  }
  const remaining = allNotes.filter(note => !included.has(note.meta.id)).length;
  add('Index pointer', `${remaining} more notes available via edu_recall/edu_read`);

  if (trackUsage) await brain.recordUse([...included], now);
  const text = fullText();
  return { text, tokens: estimateTokens(text), budgetTokens: budget, sections, deferred: deferred.filter(id => !included.has(id)) };
}

export async function buildContext(brain: Brain, req: ContextRequest, opts: ContextOptions = {}): Promise<ContextPack> {
  return assembleContext(brain, req, opts, opts.trackUsage ?? true);
}

/** Internal read-only form used for deterministic session-start briefs. */
export async function buildBriefContext(brain: Brain, budgetTokens: number, opts: ContextOptions): Promise<ContextPack> {
  return assembleContext(brain, { budgetTokens }, opts, opts.trackUsage ?? false);
}
