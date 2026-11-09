/**
 * `edu brain lint`: a read-only health report of the brain, as findings with a severity and a suggested fix.
 *
 *   - orphan: a live transitive or canonical note that no other note links to and that links nowhere;
 *   - missing-page: a [[wikilink]] (or a frontmatter link) that resolves to no note id, alias, stem or title;
 *   - contradiction: two active decisions (or accepted canonical notes of the same kind) that talk about the
 *     same thing and point in opposite directions. Lexical heuristic: always reported as "possible";
 *   - stale-claim: an active decision or accepted canonical note older than `staleDays` whose text depends on
 *     time ("currently", "hoy", a version number, a price) without an `(as of YYYY-MM-DD)` marker;
 *   - overdue: a pending or overdue commitment past its due date (maintenance flags it; lint only reports);
 *   - duplicate: notes whose normalized title or body is (nearly) identical.
 *
 * Nothing here writes. Decisions and accepted canonical notes are immutable, so their age is their `created`
 * date: `updated` also moves when a note is merely injected into context.
 */
import type { Note } from '../core/contracts.js';
import type { Brain } from './brain.js';
import { isInside } from './location.js';
import { resolveReference, type ResolveResult } from './resolve.js';
import { isOperationalNote, tokenize } from './search.js';
import { linkTargets } from './tidy.js';

export const LINT_KINDS = ['missing-page', 'contradiction', 'stale-claim', 'overdue', 'duplicate', 'orphan'] as const;
export type LintKind = (typeof LINT_KINDS)[number];
export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintFinding {
  kind: LintKind;
  severity: LintSeverity;
  /** Notes the finding is about; the first one is the note to act on. */
  ids: string[];
  message: string;
  fix: string;
  /** missing-page: the link text that resolves to nothing. */
  target?: string;
  /** stale-claim: the time-sensitive phrases found; contradiction: the opposing signal. */
  evidence?: string[];
}

export interface LintReport {
  generated: string;
  staleDays: number;
  notes: number;
  findings: LintFinding[];
  summary: Record<LintKind, number> & { error: number; warning: number; info: number; total: number };
}

export interface LintOptions {
  now?: Date;
  /** Days after which a time-sensitive claim without an as-of marker is stale (default 90). */
  staleDays?: number;
  /** Brain folder whose notes are reported on; links still resolve against every visible note. */
  root?: string;
}

const DAY = 864e5;
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Words that carry no topic, in English and Spanish. Negations are removed too: they are the signal, not the topic. */
const STOPWORDS = new Set((
  'a an the and or but if then else of to in on at by for from with without into over under about as is are was were be been being ' +
  'this that these those it its we you they he she i me my our your their them us do does did done have has had will would should can could ' +
  'may might must shall not no never nor so than too very just also only all any each every some more most other such own same both ' +
  'el la los las un una unos unas de del al a en por para con sin sobre entre y o u pero si no ni que como cuando donde cual cuales ' +
  'es son ser fue era estar esta este estos estas ese esa esos esas lo le les se su sus mi mis tu tus nuestro nuestra hay ya muy mas ' +
  'tambien solo todo todos toda todas cada otro otra otros otras nunca jamas use usar uses using used'
).split(' '));

export function topicTokens(text: string): string[] {
  return tokenize(text).filter(token => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

const NEGATION = /\b(?:no|not|never|nunca|jamas|don'?t|doesn'?t|stop|instead|dejar de|deja de|en vez de|en lugar de)\b/g;
export function negations(text: string): string[] {
  return [...new Set([...fold(text).matchAll(NEGATION)].map(match => match[0]))];
}

const TIME_SENSITIVE: RegExp[] = [
  /\b(?:today|currently|right now|now|latest|this week|this month|at the moment|actualmente|hoy|ahora|ultimo|ultima|ultimos|ultimas|esta semana|este mes)\b/g,
  /\bv?\d+\.\d+(?:\.\d+)?\b/g,
  /[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:usd|eur|clp|dolares|euros)\b/g,
];
const AS_OF = /\((?:as of|al)\s+\d{4}-\d{2}-\d{2}\)/i;
export const hasAsOfMarker = (text: string) => AS_OF.test(text);
export function timeSensitivePhrases(text: string): string[] {
  const folded = fold(text);
  return [...new Set(TIME_SENSITIVE.flatMap(pattern => [...folded.matchAll(pattern)].map(match => match[0].trim())))];
}

/** `key: value` lines and "use X" statements: the same subject with another value is an opposing signal. */
function statements(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of fold(text).split('\n')) {
    const pair = /^\s*(?:[-*]\s+)?([a-z][\w -]{1,40}?)\s*[:=]\s*(\S.{0,80}?)\s*$/.exec(line);
    // Only short values name a setting ("database: postgres"); a sentence after "Context:" is prose, not a value.
    if (pair && !/^https?$/.test(pair[1]!) && pair[2]!.split(/\s+/).length <= 3) result.set(`key:${pair[1]!.trim()}`, pair[2]!.trim());
  }
  for (const match of fold(text).matchAll(/\b(?:use|usar|usa|usamos|prefer|preferir|preferimos|choose|elegir)\s+([a-z0-9][\w.-]*)/g)) {
    if (!STOPWORDS.has(match[1]!)) result.set('use', match[1]!);
  }
  return result;
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
};

const normalized = (text: string) => tokenize(text).join(' ');

const SEVERITY: Record<LintKind, LintSeverity> = { 'missing-page': 'warning', contradiction: 'warning', 'stale-claim': 'warning', overdue: 'error', duplicate: 'warning', orphan: 'info' };

/** Lints the notes Edu can see. Pure over its input: no file is read or written. */
export function lintNotes(all: Note[], opts: LintOptions = {}): LintReport {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? 90;
  const inScope = (note: Note) => !opts.root || isInside(opts.root, note.path);
  const findings: LintFinding[] = [];
  const add = (finding: Omit<LintFinding, 'severity'> & { severity?: LintSeverity }) => findings.push({ severity: SEVERITY[finding.kind], ...finding });

  // Resolution is memoized per distinct reference: the same targets repeat across many notes.
  const byId = new Map(all.map(note => [note.meta.id, note]));
  const cache = new Map<string, ResolveResult | undefined>();
  const resolve = (reference: string) => {
    if (!cache.has(reference)) cache.set(reference, byId.has(reference) ? { via: 'id', note: byId.get(reference)! } : resolveReference(all, reference));
    return cache.get(reference);
  };
  const resolvedIds = (result: ResolveResult | undefined) => !result ? [] : 'note' in result ? [result.note.meta.id] : result.candidates.map(note => note.meta.id);

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const missing = new Map<string, Set<string>>();
  const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const note of all) {
    const references = [...linkTargets(note.body), ...note.meta.links, ...[note.meta.supersedes, note.meta.superseded_by].filter((id): id is string => Boolean(id))];
    for (const target of references) {
      const ids = resolvedIds(resolve(target)).filter(id => id !== note.meta.id);
      if (!resolve(target)) {
        if (inScope(note)) missing.set(target, (missing.get(target) ?? new Set()).add(note.meta.id));
        continue;
      }
      if (ids.length) bump(outbound, note.meta.id);
      for (const id of ids) bump(inbound, id);
    }
  }

  for (const [target, from] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    add({ kind: 'missing-page', ids: [...from].sort(), target, message: `[[${target}]] does not resolve to any note (linked from ${from.size})`, fix: `Write a note for "${target}", or correct the link to an existing note id, alias or title.` });
  }

  const live = all.filter(note => note.meta.tier !== 'episodic' && isOperationalNote(note));
  for (const note of live) {
    if (!inScope(note) || inbound.get(note.meta.id) || outbound.get(note.meta.id)) continue;
    add({ kind: 'orphan', ids: [note.meta.id], message: `${note.meta.title} has no links in or out`, fix: 'Link it from a related note (or add [[links]] to it), or retire it if it no longer matters.' });
  }

  const claims = all.filter(note => (note.meta.kind === 'decision' && note.meta.status === 'active') || (note.meta.tier === 'canonical' && note.meta.status === 'accepted'));
  const groups = new Map<string, Note[]>();
  for (const note of claims) {
    const group = note.meta.tier === 'canonical' ? `canonical/${note.meta.kind ?? 'domain'}` : 'decision';
    groups.set(group, [...(groups.get(group) ?? []), note]);
  }
  for (const notes of groups.values()) {
    const shaped = notes.map(note => ({ note, title: new Set(topicTokens(note.meta.title)), all: new Set(topicTokens(`${note.meta.title}\n${note.body}`)), neg: negations(`${note.meta.title}\n${note.body}`), said: statements(note.body) }));
    for (let i = 0; i < shaped.length; i++) for (let j = i + 1; j < shaped.length; j++) {
      // Older first, so signals read "older value vs newer value".
      const [a, b] = [shaped[i]!, shaped[j]!].sort((x, y) => x.note.meta.created.localeCompare(y.note.meta.created) || x.note.meta.id.localeCompare(y.note.meta.id)) as [typeof shaped[number], typeof shaped[number]];
      if (!inScope(a.note) && !inScope(b.note)) continue;
      if (a.note.meta.supersedes === b.note.meta.id || b.note.meta.supersedes === a.note.meta.id) continue;
      const overlap = Math.max(jaccard(a.all, b.all), jaccard(a.title, b.title));
      if (overlap < 0.4) continue;
      const signals: string[] = [];
      if (Boolean(a.neg.length) !== Boolean(b.neg.length)) signals.push(`negation: ${[...a.neg, ...b.neg].join(', ')}`);
      for (const [key, value] of a.said) {
        const other = b.said.get(key);
        if (other !== undefined && other !== value) signals.push(`${key === 'use' ? 'use' : key.slice(4)}: "${value}" vs "${other}"`);
      }
      if (!signals.length) continue;
      const older = a.note, newer = b.note;
      add({ kind: 'contradiction', ids: [older.meta.id, newer.meta.id], evidence: signals, message: `Possible contradiction (${Math.round(overlap * 100)}% overlap): "${older.meta.title}" vs "${newer.meta.title}"`, fix: older.meta.kind === 'decision' ? `If ${newer.meta.id} replaces ${older.meta.id}, record a new decision that supersedes ${older.meta.id}; otherwise reword one of them.` : `If one replaces the other, propose a revision that supersedes the older note (edu brain approve).` });
    }
  }

  for (const note of claims) {
    if (!inScope(note) || now.getTime() - Date.parse(note.meta.created) <= staleDays * DAY) continue;
    const text = `${note.meta.title}\n${note.body}`;
    if (hasAsOfMarker(text)) continue;
    const phrases = timeSensitivePhrases(text);
    if (!phrases.length) continue;
    add({ kind: 'stale-claim', ids: [note.meta.id], evidence: phrases, message: `${note.meta.title}: time-sensitive claim (${phrases.join(', ')}) unchanged since ${note.meta.created.slice(0, 10)}`, fix: 'Check it still holds and record it with an "(as of YYYY-MM-DD)" marker, or supersede it.' });
  }

  for (const note of all) {
    if (!inScope(note) || note.meta.kind !== 'commitment' || !note.meta.due || !['pending', 'overdue'].includes(note.meta.status ?? '')) continue;
    if (Date.parse(`${note.meta.due.slice(0, 10)}T23:59:59.999Z`) >= now.getTime()) continue;
    add({ kind: 'overdue', ids: [note.meta.id], message: `${note.meta.title} was due ${note.meta.due.slice(0, 10)}`, fix: 'Deliver it (status delivered) or agree a new date with its stakeholder.' });
  }

  // Duplicates: identical normalized titles or bodies, or near-identical bodies. Episodes are history, not duplicates.
  const candidates = all.filter(note => note.meta.tier !== 'episodic' && isOperationalNote(note));
  const seen = new Set<string>();
  const pair = (a: Note, b: Note, reason: string, exact: boolean) => {
    const [first, second] = [a, b].sort((x, y) => x.meta.created.localeCompare(y.meta.created) || x.meta.id.localeCompare(y.meta.id));
    const key = `${first!.meta.id}\n${second!.meta.id}`;
    if (seen.has(key) || (!inScope(first!) && !inScope(second!))) return;
    seen.add(key);
    add({ kind: 'duplicate', severity: exact ? 'error' : 'warning', ids: [first!.meta.id, second!.meta.id], evidence: [reason], message: `"${second!.meta.title}" duplicates "${first!.meta.title}" (${reason})`, fix: `Keep ${first!.meta.id} and retire or supersede ${second!.meta.id}, merging anything only the second one says.` });
  };
  const byTitle = new Map<string, Note[]>();
  const byBody = new Map<string, Note[]>();
  for (const note of candidates) {
    const title = normalized(note.meta.title), body = normalized(note.body);
    if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), note]);
    if (body.length >= 20) byBody.set(body, [...(byBody.get(body) ?? []), note]);
  }
  // An identical normalized body is an error (two notes that can drift apart); a shared title or near-identical text is a warning.
  for (const group of byBody.values()) for (let i = 1; i < group.length; i++) pair(group[0]!, group[i]!, normalized(group[0]!.meta.title) === normalized(group[i]!.meta.title) ? 'same title and body' : 'same body', true);
  for (const group of byTitle.values()) for (let i = 1; i < group.length; i++) pair(group[0]!, group[i]!, 'same title', false);
  const bodies = candidates.map(note => ({ note, tokens: new Set(topicTokens(note.body)) })).filter(entry => entry.tokens.size >= 8);
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i]!, b = bodies[j]!;
    if (Math.min(a.tokens.size, b.tokens.size) / Math.max(a.tokens.size, b.tokens.size) < 0.85) continue;
    const similarity = jaccard(a.tokens, b.tokens);
    if (similarity >= 0.9) pair(a.note, b.note, `${Math.round(similarity * 100)}% same words`, false);
  }

  const order = new Map(LINT_KINDS.map((kind, index) => [kind, index]));
  findings.sort((a, b) => order.get(a.kind)! - order.get(b.kind)! || a.ids[0]!.localeCompare(b.ids[0]!));
  const summary = Object.fromEntries(LINT_KINDS.map(kind => [kind, 0])) as LintReport['summary'];
  summary.error = 0; summary.warning = 0; summary.info = 0; summary.total = findings.length;
  for (const finding of findings) { summary[finding.kind]++; summary[finding.severity]++; }
  return { generated: now.toISOString(), staleDays, notes: all.filter(inScope).length, findings, summary };
}

/** Lints every note the brain can see; `root` limits the report to one location's notes. */
export async function lintBrain(brain: Brain, opts: LintOptions = {}): Promise<LintReport> {
  return lintNotes(await brain.list(), opts);
}
