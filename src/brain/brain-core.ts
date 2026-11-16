/**
 * The shared machinery of one open brain: its locations, the overlay listing, the root locks, note persistence and
 * catalog upkeep. The method groups of `openBrain` (writes, recall, maintenance, canonical review) are built on it.
 */
import { access, mkdir, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import type { BrainLocation, Note, NoteMeta, NoteOrigin } from '../core/contracts.js';
import type { NewNote } from './brain-types.js';
import { appendLog, writeCatalog, type LogOp } from './catalog.js';
import { cleanBody, cleanTitle } from './clean-text.js';
import { frontmatterUsage, mergeExposure, readLedger } from './ledger.js';
import { brainPath, isInside } from './location.js';
import { withUsageLock } from './note-lock.js';
import { REDACTED_TAG, redactSecrets, redactValue } from './redact.js';
import { assertInsideBrain } from './safe-path.js';
import { PathTakenError, atomicWrite, encodeNote, exclusiveWrite, inspectNote, isAlreadyExists, listLocation, overlay, overlayScan, type NoteProblem } from './store.js';
import type { ViewOptions } from './views.js';

export const iso = (d = new Date()) => d.toISOString();
/** Source of the episodic record a rejected canonical proposal leaves behind. */
export const REJECT_SOURCE = 'edu:reject';
export const pathExists = (path: string) => access(path).then(() => true, () => false);
/** Provenance fields for a write; `host` defaults to this machine. Undefined fields are omitted. */
export const originOf = (by: NoteOrigin | undefined): Pick<NoteMeta, 'host' | 'agent' | 'session'> => {
  const clean = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const host = clean(by?.host) ?? hostname(), agent = clean(by?.agent), session = clean(by?.session);
  return { ...(host ? { host } : {}), ...(agent ? { agent } : {}), ...(session ? { session } : {}) };
};

/** Free-text fields of a new note redacted with the title and body (ids, links and lifecycle fields are not free text). */
const NEW_NOTE_TEXT = ['tags', 'source', 'owner', 'stakeholder', 'provenance', 'by'] as const satisfies readonly (keyof NewNote)[];
/** Free-text frontmatter an update patch may carry. */
export const META_TEXT = ['tags', 'source', 'owner', 'stakeholder', 'aliases', 'origin', 'albert', 'legacy_id', 'import_warning'] as const satisfies readonly (keyof NoteMeta)[];

/** Redacts the listed fields of `record` in place on a copy; returns the copy and the kinds found. */
export function redactFields<T extends object>(record: T, keys: readonly (keyof T)[]): { record: T; kinds: string[] } {
  const out = { ...record }, kinds: string[] = [];
  for (const key of keys) {
    if (out[key] === undefined) continue;
    const result = redactValue(out[key]);
    out[key] = result.value;
    for (const kind of result.kinds) if (!kinds.includes(kind)) kinds.push(kind);
  }
  return { record: out, kinds };
}

/**
 * Cleans and redacts a new note: control characters leave the title and NUL bytes the body (see `clean-text.ts`),
 * then secrets are redacted from the title, body and free-text metadata; a redacted note is tagged `redacted`.
 */
export function redactInput(raw: NewNote): { input: NewNote; kinds: string[] } {
  const input = { ...raw, title: cleanTitle(String(raw.title ?? '')), body: cleanBody(String(raw.body ?? '')) };
  const title = redactSecrets(input.title), body = redactSecrets(input.body), meta = redactFields(input, NEW_NOTE_TEXT);
  const kinds = [...new Set([...title.kinds, ...body.kinds, ...meta.kinds])];
  if (!kinds.length) return { input, kinds };
  return { input: { ...meta.record, title: title.text, body: body.text, tags: [...new Set([...(meta.record.tags ?? []), REDACTED_TAG])] }, kinds };
}

export interface BrainCore {
  readonly locations: BrainLocation[];
  /** The first location: new notes, shadows and the index go here. */
  readonly primary: BrainLocation;
  readonly viewOptions: ViewOptions;
  /** The location owning a file (by brain folder); the primary when none does. */
  locationOf(path: string): BrainLocation;
  /** The location root that owns a file: the lock for a write is taken on the root actually written. */
  rootOf(path: string): string;
  /** Notes as the rest of Edu sees them: frontmatter feedback merged with the root's exposure ledger. */
  withExposure(notes: Note[]): Promise<Note[]>;
  /** Every note of the overlay (higher-priority locations shadow lower ones), with exposure. */
  all(): Promise<Note[]>;
  find(id: string): Promise<Note | undefined>;
  /** Quarantined files seen by the latest full listing; lists once when there was none yet. */
  problems(): Promise<NoteProblem[]>;
  log(note: Note, op: LogOp): Promise<void>;
  /** Takes the usage lock of every distinct root, in a fixed order (no deadlock across processes), once each (never re-entrant). */
  withRoots<T>(roots: string[], body: () => Promise<T>): Promise<T>;
  /** Writes a note (replacing only its own file); returns it as read paths see it (ledger merged). */
  persist(note: Note): Promise<Note>;
  /** Writes a brand-new note without ever replacing a file (`-2`, `-3`, … when its path is taken). */
  createNote(note: Note): Promise<Note>;
  /** Writes one location's catalog; a failure is a warning, reported as not written. */
  catalogSafely(loc: BrainLocation, notes: Note[]): Promise<boolean>;
  /** Rebuilds the catalogs whose view includes a changed file; deferred to the end of a batch. */
  refreshCatalogs(paths: string[]): Promise<void>;
  liveReferrer(note: Note): boolean;
  /** True inside `batch`: catalogs are rebuilt once when the outermost batch ends. */
  readonly batching: boolean;
  batch<T>(work: () => Promise<T>): Promise<T>;
}

export function createBrainCore(locations: BrainLocation[], viewOptions: ViewOptions): BrainCore {
  const primary = locations[0]!;
  const locationOf = (path: string) => locations.find(loc => isInside(brainPath(loc), path)) ?? primary;
  const withExposure = async (notes: Note[]): Promise<Note[]> => {
    const ledgers = new Map<string, Awaited<ReturnType<typeof readLedger>>>();
    for (const note of notes) {
      const root = locationOf(note.path).root;
      let ledger = ledgers.get(root);
      if (!ledger) { ledger = await readLedger(root); ledgers.set(root, ledger); }
      const usage = mergeExposure(note.meta.usage, ledger.notes[note.meta.id]);
      if (usage) note.meta.usage = usage;
    }
    return notes;
  };
  /** Quarantined files seen by the latest full listing (`problems()` reuses it instead of listing again). */
  let lastProblems: NoteProblem[] | undefined;
  const all = async () => {
    const scan = await overlayScan(locations);
    lastProblems = scan.problems;
    return withExposure(scan.notes);
  };
  const log = (note: Note, op: LogOp) => appendLog(brainPath(locationOf(note.path)), { op, id: note.meta.id, title: note.meta.title });
  const rootOf = (path: string) => locationOf(path).root;
  const withRoots = async <T>(roots: string[], body: () => Promise<T>): Promise<T> => {
    // Canonical real paths: an alias or junction to the same root must not take the same lock twice (self-timeout),
    // and processes using either spelling must contend on the same directory.
    const canonical = await Promise.all(roots.map(async root => { await mkdir(resolve(root), { recursive: true }); return realpath(resolve(root)); }));
    const [first, ...rest] = [...new Map(canonical.map(root => [process.platform === 'win32' ? root.toLowerCase() : root, root])).values()].sort();
    if (first === undefined) return body();
    return withUsageLock(first, () => rest.length ? withRoots(rest, body) : body());
  };
  /**
   * Keeps `0-index/catalog.md` fresh after a mutation: rebuilds the catalog of every location whose view includes a
   * changed file (its own location and the higher-priority ones that overlay it), under those roots' locks. Only the
   * catalog, not INDEX.md or the Obsidian views; `writeCatalog` leaves an unchanged catalog untouched. Must run after
   * the mutation's own locks are released (locks are not re-entrant). A failure is a warning, never a failed write.
   */
  const liveReferrer = (note: Note) => note.meta.source !== REJECT_SOURCE;
  let batchDepth = 0;
  let batchPaths: string[] = [];
  const catalogSafely = async (loc: BrainLocation, notes: Note[]): Promise<boolean> => {
    try { await writeCatalog(brainPath(loc), notes, liveReferrer); return true; }
    catch (error) { process.emitWarning(`catalog not refreshed: ${error instanceof Error ? error.message : String(error)}`, 'EduWarning'); return false; }
  };
  const refreshCatalogs = async (paths: string[]) => {
    if (batchDepth > 0) { batchPaths.push(...paths); return; }
    const deepest = Math.max(0, ...paths.map(path => locations.indexOf(locationOf(path))));
    const affected = locations.slice(0, deepest + 1);
    try {
      await withRoots(affected.map(loc => loc.root), async () => {
        // Each location is listed once; the catalog of location i is the overlay of locations i…n.
        const lists = await Promise.all(locations.map(loc => listLocation(loc)));
        for (const [index, loc] of affected.entries()) await writeCatalog(brainPath(loc), overlay(lists.slice(index)), liveReferrer);
      });
    } catch (error) {
      process.emitWarning(`catalog not refreshed: ${error instanceof Error ? error.message : String(error)}`, 'EduWarning');
    }
  };
  /**
   * Writes a note. Exposure never reaches the file: the frontmatter keeps the feedback in `note.meta.usage` and
   * whatever legacy exposure the file already had. Returns the note as read paths see it (ledger merged).
   */
  const persist = async (note: Note) => {
    // Containment first: a path that is (or sits under) a symbolic link is refused, never read through or replaced.
    await assertInsideBrain(brainPath(locationOf(note.path)), note.path);
    const read = await inspectNote(note.path);
    // Never replaces another note's file or a quarantined one (the user must repair it first).
    if (read && 'problem' in read) throw new PathTakenError(`${note.path} could not be read as a note (${read.problem}); it was left untouched`);
    if (read && read.note.meta.id !== note.meta.id) throw new PathTakenError(`${note.path} holds another note (${read.note.meta.id}); it was left untouched`);
    const disk = read?.note;
    const usage = frontmatterUsage(note.meta.usage, disk?.meta.usage, disk === undefined);
    const meta: NoteMeta = { ...note.meta };
    if (usage) meta.usage = usage; else delete meta.usage;
    // Refuses (throws) a note path that is, or sits under, a symbolic link inside the brain. A new file is created
    // exclusively: if anything appeared at the path meanwhile, the write fails instead of replacing it.
    const write = disk ? atomicWrite : exclusiveWrite;
    await write(note.path, encodeNote({ ...note, meta }), { root: brainPath(locationOf(note.path)) });
    return (await withExposure([{ ...note, meta: structuredClone(meta) }]))[0]!;
  };
  /**
   * Writes a brand-new note without ever replacing a file: when its title-derived path is taken (a note with another
   * id, a quarantined or foreign file), the next free name (`-2`, `-3`, …) is used. The id is unchanged.
   */
  const createNote = async (note: Note): Promise<Note> => {
    for (let n = 1; n <= 100; n++) {
      const path = n === 1 ? note.path : note.path.replace(/\.md$/, `-${n}.md`);
      try { return await persist({ ...note, path }); }
      catch (error) { if (!isAlreadyExists(error)) throw error; }
    }
    throw new Error(`No free file name for ${note.meta.id} next to ${note.path}`);
  };

  return {
    locations, primary, viewOptions,
    locationOf, rootOf, withExposure, all,
    find: async (id: string) => (await all()).find(note => note.meta.id === id),
    problems: async () => lastProblems ?? (await overlayScan(locations)).problems,
    log, withRoots, persist, createNote, catalogSafely, refreshCatalogs, liveReferrer,
    get batching() { return batchDepth > 0; },
    async batch(work) {
      batchDepth++;
      try { return await work(); } finally {
        if (--batchDepth === 0 && batchPaths.length) { const paths = batchPaths; batchPaths = []; await refreshCatalogs(paths); }
      }
    },
  };
}
