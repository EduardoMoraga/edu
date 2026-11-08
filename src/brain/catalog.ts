/**
 * The brain's compiled catalog and its operation log (Karpathy's LLM-wiki `index.md` + `log.md`).
 *
 * - `0-index/catalog.md` is regenerated with the index: one line per live note
 *   (`- [[id]] title — summary`) grouped by tier/kind, plus a Gaps section listing `[[wikilinks]]` that
 *   point at no note. It is named `catalog.md`, not `index.md`, because `index.md` and `INDEX.md` are the
 *   same file on case-insensitive filesystems (macOS, Windows). It carries no timestamp: an unchanged brain
 *   produces a byte-identical catalog (no sync churn).
 * - `0-index/log.md` is append-only, one grep-parseable line per brain operation:
 *   `## [YYYY-MM-DD HH:MM] <op> | <id> | <title>` (UTC). It is never regenerated; in git it merges with
 *   `merge=union`.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { INDEX_DIR, type Note, type Tier } from '../core/contracts.js';
import { atomicWrite } from './store.js';

export const CATALOG_FILE = 'catalog.md';
export const LOG_FILE = 'log.md';
const SUMMARY_MAX = 120;
const TIER_ORDER: Tier[] = ['canonical', 'transitive', 'episodic'];

/** Operations recorded in `log.md`. `status:<new>` for other lifecycle changes, `maintain:<new>` for maintenance. */
export type LogOp = 'write' | 'supersede' | 'accept' | 'reject' | 'close-session' | `status:${string}` | `maintain:${string}` | `move:${string}`;

export interface LogEntry { at: string; op: string; id: string; title: string }

/** Not historical: superseded, retired and reverted notes leave the catalog (they stay readable by id). */
export function isLiveNote(note: Note): boolean {
  return !note.meta.superseded_by && !['retired', 'reverted', 'superseded'].includes(note.meta.status ?? '');
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
/** Wikilinks shown as their label, so summaries do not add links (or false gaps) to the catalog. */
const unlink = (text: string) => text.replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => label ?? target);

/** First meaningful line of the body, plain, at most 120 characters. */
export function noteSummary(body: string, max = SUMMARY_MAX): string {
  const text = body.replace(/```[\s\S]*?```/g, '');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || /^\|?[\s:-]+\|[\s|:-]*$/.test(line)) continue;
    const plain = oneLine(unlink(line.replace(/^(?:>\s*)+/, '').replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')));
    if (plain) return truncate(plain, max);
  }
  return '';
}

/** The wikilink target a reference names (`[[a/b#h|label]]` → `b`), or undefined for non-note embeds. */
export function wikiTarget(reference: string): string | undefined {
  const target = reference.split('|')[0]!.split('#')[0]!.trim().replace(/\\/g, '/');
  if (!target) return undefined;
  const name = target.split('/').pop()!;
  if (/\.[A-Za-z0-9]{1,5}$/.test(name) && !/\.md$/i.test(name)) return undefined;
  return name.replace(/\.md$/i, '');
}

const GENERATED_TARGETS = new Set(['index', 'catalog', 'log']);

/**
 * `[[targets]]` (from `links` and body wikilinks of live notes) that match no note id, legacy id, alias,
 * filename stem or title. Returns target → referring note ids.
 */
export function findGaps(notes: Note[], isReferrer: (note: Note) => boolean = () => true): Map<string, string[]> {
  const known = new Set<string>();
  for (const note of notes) {
    const names = [note.meta.id, note.meta.legacy_id, note.meta.title, basename(note.path, '.md'), ...(Array.isArray(note.meta.aliases) ? note.meta.aliases : [])];
    for (const name of names) if (typeof name === 'string' && name) known.add(name.toLowerCase());
  }
  const gaps = new Map<string, string[]>();
  for (const note of notes) {
    if (!isLiveNote(note) || !isReferrer(note)) continue;
    const body = note.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const references = [...(Array.isArray(note.meta.links) ? note.meta.links : []), ...[...body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)].filter(m => !m[1]).map(m => m[2]!)];
    for (const reference of references) {
      if (typeof reference !== 'string') continue;
      const target = wikiTarget(reference);
      if (!target || known.has(target.toLowerCase()) || GENERATED_TARGETS.has(target.toLowerCase())) continue;
      const referrers = gaps.get(target) ?? [];
      if (!referrers.includes(note.meta.id)) referrers.push(note.meta.id);
      gaps.set(target, referrers);
    }
  }
  return gaps;
}

const linkTo = (note: Note) => {
  const stem = basename(note.path, '.md');
  return stem === note.meta.id ? `[[${note.meta.id}]]` : `[[${stem}|${note.meta.id}]]`;
};

/** The catalog text for a set of notes (deterministic: no timestamp, stable ordering). */
export function buildCatalog(notes: Note[], isReferrer?: (note: Note) => boolean): string {
  const live = notes.filter(isLiveNote);
  const groups = new Map<string, Note[]>();
  for (const note of live) {
    const key = `${note.meta.tier}/${note.meta.kind ?? 'other'}`;
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const order = (key: string) => TIER_ORDER.indexOf(key.split('/')[0] as Tier);
  const lines = ['# Brain catalog', '', `${live.length} live notes. One line each: \`[[id]] title — summary\`. Read a note with edu_read.`, ''];
  for (const [key, group] of [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))) {
    lines.push(`## ${key}`, '');
    const sorted = key.startsWith('episodic/')
      ? group.sort((a, b) => b.meta.created.localeCompare(a.meta.created) || a.meta.id.localeCompare(b.meta.id))
      : group.sort((a, b) => a.meta.title.localeCompare(b.meta.title) || a.meta.id.localeCompare(b.meta.id));
    for (const note of sorted) {
      const summary = noteSummary(note.body);
      lines.push(`- ${linkTo(note)} ${oneLine(note.meta.title)}${summary ? ` — ${summary}` : ''}`);
    }
    lines.push('');
  }
  const gaps = [...findGaps(notes, isReferrer)].sort(([a], [b]) => a.localeCompare(b));
  lines.push('## Gaps', '');
  if (!gaps.length) lines.push('No missing notes.');
  for (const [target, referrers] of gaps) lines.push(`- [[${target}]] — referenced by ${referrers.sort().map(id => `[[${id}]]`).join(', ')}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/** Writes `0-index/catalog.md` only when its content changed. */
export async function writeCatalog(brainDir: string, notes: Note[], isReferrer?: (note: Note) => boolean): Promise<boolean> {
  const path = join(brainDir, INDEX_DIR, CATALOG_FILE);
  const content = buildCatalog(notes, isReferrer);
  if (await readFile(path, 'utf8').catch(() => undefined) === content) return false;
  await atomicWrite(path, content);
  return true;
}

const field = (value: string) => oneLine(value).replace(/\|/g, '/');

export function formatLogLine(entry: { op: string; id: string; title: string; at?: Date }): string {
  const stamp = (entry.at ?? new Date()).toISOString();
  return `## [${stamp.slice(0, 10)} ${stamp.slice(11, 16)}] ${field(entry.op)} | ${field(entry.id)} | ${field(entry.title)}`;
}

/** Parses `log.md` lines; anything else in the file is ignored. */
export function parseLog(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] (.+?) \| (.+?) \| (.*)$/.exec(line);
    if (match) out.push({ at: match[1]!, op: match[2]!, id: match[3]!, title: match[4]! });
  }
  return out;
}

/**
 * Appends one line to `0-index/log.md` (creating it with a header). Appends are small single writes, so
 * concurrent writers interleave whole lines. Best effort: a log failure never fails the brain operation.
 */
export async function appendLog(brainDir: string, entry: { op: LogOp; id: string; title: string; at?: Date }): Promise<void> {
  try {
    const dir = join(brainDir, INDEX_DIR);
    const path = join(dir, LOG_FILE);
    await mkdir(dir, { recursive: true });
    await writeFile(path, '# Brain log\n\nAppend-only. One line per operation: `## [YYYY-MM-DD HH:MM] op | id | title` (UTC).\n\n', { flag: 'wx' })
      .catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    await appendFile(path, `${formatLogLine(entry)}\n`);
  } catch { /* the log is an aid, not the source of truth */ }
}
