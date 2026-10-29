/**
 * `edu brain tidy`: what maintenance never cleans, as a reviewable plan.
 *
 * Maintenance promotes and retires lessons, flags overdue commitments and rebuilds the index. It never touches:
 *   - empty sessions: an episode opened at session start that nothing ever filled (host exited without closing);
 *   - stale hypotheses: open long after anyone returned to them, crowding the brief;
 *   - broken links whose target is known: a link written with an imported note's original file name.
 * Planning reads only. Applying runs the saved plan (which the user may edit), backs up every file it changes,
 * and writes through the brain so lifecycle rules and locks still hold. Nothing else is inferred: a stale
 * hypothesis becomes `no-evidence`, never `confirmed` or `refuted`, which need evidence a script does not have.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import type { BrainLocation, Note } from '../core/contracts.js';
import type { Brain } from './brain.js';
import { isClosedEpisode } from './lifecycle.js';
import { brainPath, isInside } from './location.js';
import { atomicWrite } from './store.js';

export const TIDY_KINDS = ['sessions', 'hypotheses', 'aliases'] as const;
export type TidyKind = (typeof TIDY_KINDS)[number];

export interface TidyPlan {
  version: 1;
  generated: string;
  /** Brain folder the plan was made for; applying it to another brain is refused. */
  brain: string;
  staleDays: number;
  sessions: { id: string; title: string; created: string }[];
  hypotheses: { id: string; title: string; created: string; to: 'no-evidence' }[];
  aliases: { id: string; title: string; add: string[] }[];
  /** Broken links with one known target that Edu cannot edit (accepted canonical, closed episode): fix by hand. */
  manual: { link: string; target: string; reason: string }[];
  /** Broken links with no single known target: kept, a broken link marks a note still to write. */
  unresolved: number;
}

export interface TidyResult { backup: string; sessions: number; hypotheses: number; aliases: number; skipped: { id: string; reason: string }[] }

const DAY = 864e5;
/** An open session younger than this may still be running: never discarded. */
const SESSION_GRACE_MS = DAY;
const WIKILINK = /\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g;
const stem = (path: string) => basename(path).replace(/\.md$/i, '');
const key = (text: string) => text.trim().toLowerCase();

/** Link targets written in a note body, as Obsidian resolves them: the last path segment, without `.md`. */
export function linkTargets(body: string): string[] {
  return [...body.matchAll(WIKILINK)].map(match => stem(match[1]!.trim().replace(/\\/g, '/')));
}

/** Read-only: what tidy would change in the primary brain. */
export async function planTidy(brain: Brain, primary: BrainLocation, opts: { now?: Date; staleDays?: number } = {}): Promise<TidyPlan> {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? 30;
  const root = brainPath(primary);
  const notes = (await brain.list()).filter(note => isInside(root, note.path));

  const names = new Set<string>();
  for (const note of notes) {
    for (const name of [note.meta.id, stem(note.path), note.meta.title, ...(note.meta.aliases ?? [])]) if (name) names.add(key(name));
  }
  const referenced = new Set<string>();
  for (const note of notes) for (const target of [...linkTargets(note.body), ...note.meta.links]) referenced.add(key(target));

  const age = (iso: string | undefined) => now.getTime() - new Date(iso ?? now).getTime();
  const sessions = notes
    .filter(note => note.meta.kind === 'session' && note.meta.status === 'open-session' && !note.body.trim()
      && age(note.meta.created) > SESSION_GRACE_MS && !referenced.has(key(note.meta.id)) && !referenced.has(key(stem(note.path))))
    .map(note => ({ id: note.meta.id, title: note.meta.title, created: note.meta.created }));
  // `updated` moves whenever a note is injected into context, so age is measured from creation.
  const hypotheses = notes
    .filter(note => note.meta.kind === 'hypothesis' && note.meta.status === 'open' && age(note.meta.created) > staleDays * DAY)
    .map(note => ({ id: note.meta.id, title: note.meta.title, created: note.meta.created, to: 'no-evidence' as const }));

  const byOrigin = new Map<string, Note[]>();
  for (const note of notes) {
    if (!note.meta.origin) continue;
    const name = key(stem(note.meta.origin.replace(/^[a-z]+:/i, '')));
    byOrigin.set(name, [...(byOrigin.get(name) ?? []), note]);
  }
  const additions = new Map<string, Set<string>>();
  const manual = new Map<string, TidyPlan['manual'][number]>();
  let unresolved = 0;
  const broken = new Set<string>();
  for (const note of notes) for (const target of linkTargets(note.body)) if (!names.has(key(target))) broken.add(target);
  for (const target of broken) {
    const candidates = byOrigin.get(key(target)) ?? [];
    if (candidates.length !== 1) { unresolved++; continue; }
    const owner = candidates[0]!;
    const editable = owner.meta.tier !== 'canonical' && !isClosedEpisode(owner.meta);
    if (!editable) {
      manual.set(key(target), { link: target, target: owner.meta.id, reason: owner.meta.tier === 'canonical' ? 'accepted canonical notes are immutable' : 'closed episodes are immutable' });
      continue;
    }
    additions.set(owner.meta.id, (additions.get(owner.meta.id) ?? new Set()).add(target));
  }
  const aliases = [...additions].map(([id, add]) => ({ id, title: notes.find(note => note.meta.id === id)!.meta.title, add: [...add].sort() }));

  return { version: 1, generated: now.toISOString(), brain: root, staleDays, sessions, hypotheses, aliases, manual: [...manual.values()], unresolved };
}

export const tidyPlanPath = (primary: BrainLocation) => join(primary.root, 'state', 'tidy-plan.json');

export async function saveTidyPlan(primary: BrainLocation, plan: TidyPlan): Promise<string> {
  const path = tidyPlanPath(primary);
  await atomicWrite(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}

export async function loadTidyPlan(primary: BrainLocation): Promise<TidyPlan | undefined> {
  const raw = await readFile(tidyPlanPath(primary), 'utf8').catch(() => undefined);
  if (raw === undefined) return undefined;
  const plan = JSON.parse(raw) as TidyPlan;
  if (plan?.version !== 1 || !Array.isArray(plan.sessions) || !Array.isArray(plan.hypotheses) || !Array.isArray(plan.aliases)) throw new Error(`Unreadable tidy plan: ${tidyPlanPath(primary)}`);
  return plan;
}

/** Applies a saved (possibly edited) plan. Every changed file is copied to `<root>/backups/tidy-<stamp>/` first. */
export async function applyTidy(brain: Brain, primary: BrainLocation, plan: TidyPlan, opts: { only?: TidyKind[]; now?: Date } = {}): Promise<TidyResult> {
  const root = brainPath(primary);
  if (plan.brain !== root) throw new Error(`The tidy plan was made for ${plan.brain}, not ${root}. Run edu brain tidy again.`);
  const only = new Set(opts.only?.length ? opts.only : TIDY_KINDS);
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backup = join(primary.root, 'backups', `tidy-${stamp}`);
  const result: TidyResult = { backup, sessions: 0, hypotheses: 0, aliases: 0, skipped: [] };
  const save = async (note: Note) => {
    const target = join(backup, relative(root, note.path));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(note.path, target);
  };
  const current = async (id: string) => { const note = await brain.read(id); if (note && isInside(root, note.path)) return note; result.skipped.push({ id, reason: 'not found in this brain' }); return undefined; };

  if (only.has('sessions')) for (const { id } of plan.sessions) {
    const note = await current(id); if (!note) continue;
    if (note.meta.status !== 'open-session' || note.body.trim()) { result.skipped.push({ id, reason: 'session is no longer open and empty' }); continue; }
    await save(note);
    if (await brain.discardEmptySession(id)) result.sessions++;
    else result.skipped.push({ id, reason: 'session changed before it could be discarded' });
  }
  if (only.has('hypotheses')) for (const { id } of plan.hypotheses) {
    const note = await current(id); if (!note) continue;
    if (note.meta.status !== 'open') { result.skipped.push({ id, reason: `hypothesis is already ${note.meta.status}` }); continue; }
    await save(note);
    await brain.update(id, { status: 'no-evidence' });
    result.hypotheses++;
  }
  if (only.has('aliases')) for (const { id, add } of plan.aliases) {
    const note = await current(id); if (!note) continue;
    const merged = [...new Set([...(note.meta.aliases ?? []), ...add])];
    if (merged.length === (note.meta.aliases ?? []).length) continue;
    await save(note);
    try { await brain.update(id, { aliases: merged }); result.aliases++; } catch (error) { result.skipped.push({ id, reason: error instanceof Error ? error.message : String(error) }); }
  }
  await brain.rebuildIndex();
  return result;
}
