import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { BrainLocation, CanonicalKind, ClaimBand, FeedbackContext, Note, NoteMeta, NoteOrigin, RecallHit, Tier } from '../core/contracts.js';
import { brainPath, isInside } from './location.js';
import { writeObsidianViews, type ViewOptions } from './views.js';
import { INDEX_DIR, NoteConflictError, atomicWrite, contentHash, createId, encodeNote, listLocation, notePath, overlayNotes, readNote, slugify } from './store.js';
import { withUsageLock } from './note-lock.js';
import { assertDecisionReversion, isClosedEpisode, validateTransition, validateStatus } from './lifecycle.js';
import { assertFeedbackContext, feedbackUsage, applyLearning } from './learning.js';
import { rankNotes, rankQueries } from './search.js';
import { resolveReference, type ResolveResult } from './resolve.js';
import { ensureLocalIgnored, frontmatterUsage, mergeExposure, nextExposure, readLedger, updateLedger } from './ledger.js';
import { REDACTED_TAG, redactSecrets, redactValue } from './redact.js';
import { compileNote, type CompileReport } from './compile.js';
import { CATALOG_FILE, appendLog, warnUnsafe, writeCatalog, type LogOp } from './catalog.js';

export interface NewNote {
  title: string;
  body: string;
  tier: Tier;
  kind?: NoteMeta['kind'];
  status?: NoteMeta['status'];
  band?: ClaimBand;
  tags?: string[];
  links?: string[];
  source?: string;
  owner?: string;
  stakeholder?: string;
  due?: string;
  supersedes?: string;
  created?: string;
  updated?: string;
  /** Provenance kept verbatim on the note (importers only); never overrides the identity fields above. */
  provenance?: NoteProvenance;
  /**
   * Imported history (importers only): the status and `supersedes` are written as the source states them,
   * without requiring the superseded decision to be active and without reverting it (the source already did).
   */
  historical?: boolean;
  /** Who is writing (provenance): recorded as `host` (default `os.hostname()`), `agent` and `session`. */
  by?: NoteOrigin;
}
/** Options of `Brain.update`. */
export interface UpdateOptions {
  /**
   * Hash-guarded write: the `contentHash` the caller read. When the note changed meanwhile the update throws
   * `NoteConflictError` (code `note-conflict`, with the current hash) instead of overwriting the other change.
   */
  expectedHash?: string;
  /** Provenance of this edit; replaces the note's `host`/`agent`/`session` (host defaults to `os.hostname()`). */
  by?: NoteOrigin;
}
/** What `Brain.remember` wrote and what compiling it found. */
export interface RememberResult { note: Note; report: CompileReport }
/** Optional frontmatter an importer may attach to a note it writes. */
export type NoteProvenance = Pick<NoteMeta, 'import_warning' | 'aliases' | 'legacy_id' | 'origin' | 'albert' | 'superseded_by'>;
export interface MaintenanceReport { changed: string[]; promoted: string[]; retired: string[]; overdue: string[]; indexRebuilt: boolean }
export interface BrainStats { total: number; byTier: Record<Tier, number>; byKind: Record<string, number>; byStatus: Record<string, number> }

export interface Brain {
  init(loc: BrainLocation, opts?: { identityName?: string }): Promise<void>;
  list(filter?: Partial<Pick<NoteMeta, 'tier' | 'kind' | 'status'>>): Promise<Note[]>;
  /** Exact id only (internal lookups). For what a human or agent types, use `resolve`. */
  read(id: string): Promise<Note | undefined>;
  /** Resolves an id, legacy id/alias, id prefix, filename stem or exact title; ambiguity returns candidates. */
  resolve(reference: string): Promise<ResolveResult | undefined>;
  /** Writes a new note. Secrets in the title and body are redacted first (the note is tagged `redacted`). */
  write(input: NewNote): Promise<Note>;
  /**
   * `write` plus compile: a transitive or canonical note is linked to up to 5 related live notes and the result
   * reports possible contradictions (same-kind active decisions / accepted canonical notes) and redactions.
   * Other notes are never modified.
   */
  remember(input: NewNote): Promise<RememberResult>;
  update(id: string, patch: Partial<NoteMeta>, body?: string, options?: UpdateOptions): Promise<Note>;
  /** The note's current `contentHash` (for `update(..., { expectedHash })`), or undefined when it does not exist. */
  hashOf(id: string): Promise<string | undefined>;
  /**
   * Several queries (the same question rephrased or translated; trimmed, deduplicated, at most 4) are each
   * ranked and fused with Reciprocal Rank Fusion (k = 60); a fused hit's score is its RRF score, and notes named
   * by id or alias stay on top. One string ranks exactly as before.
   */
  recall(query: string | readonly string[], opts?: { limit?: number; tiers?: Tier[] }): Promise<RecallHit[]>;
  /**
   * Without `context` the feedback is advisory (counts as a ranking signal, never promotes). With a `context` it is
   * deduplicated by `eventId`; only trusted runtime callers may pass `verified: true` (MCP stays advisory).
   * When the note lives only in a lower-priority (global) location, a non-canonical lesson's updated copy is
   * written to the primary (project) location instead of mutating the global file.
   */
  feedback(id: string, helpful: boolean, context?: FeedbackContext): Promise<Note>;
  /**
   * Records that notes were used (injected into context). Exposure goes to the machine-local ledger
   * (`<root>/.edu-local/usage.json`), never to the note files; closed episodes are skipped.
   */
  recordUse(ids: string[], now?: Date): Promise<void>;
  openSession(title: string, source: string, by?: NoteOrigin): Promise<Note>;
  closeSession(id: string, summary: string, options?: UpdateOptions): Promise<Note>;
  proposeCanonical(input: NewNote): Promise<Note>;
  acceptCanonical(id: string): Promise<Note>;
  /**
   * Rejects a proposed canonical note. The canonical lifecycle has no rejected state and accepted notes are
   * immutable, so the proposal file is deleted and a closed episodic note (source `edu:reject`, linking the
   * proposal id and its links) keeps the record; maintenance will not re-propose a lesson linked there.
   */
  rejectCanonical(id: string, reason?: string): Promise<Note>;
  maintain(now?: Date): Promise<MaintenanceReport>;
  /**
   * Deletes a session episode that is still open and has no body: nothing was ever recorded in it, so nothing is lost.
   * Re-checked under the root lock; any other note (closed, with content, not a session) is left untouched and returns false.
   */
  discardEmptySession(id: string): Promise<boolean>;
  rebuildIndex(): Promise<void>;
  /**
   * Runs many writes as one batch: the catalog is rebuilt once at the end instead of after every write (importers).
   * Batches nest; only the outermost one rebuilds.
   */
  batch<T>(work: () => Promise<T>): Promise<T>;
  stats(): Promise<BrainStats>;
  /**
   * Moves a note to another location of this brain (e.g. project → global), keeping its id, file content and
   * frontmatter verbatim; its machine-local exposure follows it. Under the locks of both roots: refused when the
   * target already has the id (or the file), or for an open session. The target is written and read back first;
   * the source file is removed only after that. Both brains log `move:<target scope>` and get a fresh catalog.
   */
  move(id: string, targetRoot: string): Promise<Note>;
}

const fallbackEdu = `# EDU\n\nEdu is the durable, engine-independent memory contract.\n\n- Keep canonical notes human-confirmed.\n- Never edit closed session notes.\n- Record decisions as new notes when they change.\n`;
const iso = (d = new Date()) => d.toISOString();
const defaultStatus = (tier: Tier, kind: NoteMeta['kind']): NoteMeta['status'] => tier === 'canonical' ? 'proposed' : ({ decision: 'active', hypothesis: 'open', commitment: 'pending', lesson: 'candidate', session: 'open-session' } as const)[kind as 'decision' | 'hypothesis' | 'commitment' | 'lesson' | 'session'];
/** Source of the episodic record a rejected canonical proposal leaves behind. */
export const REJECT_SOURCE = 'edu:reject';
/**
 * Exposure is a learning signal, not a log: a note already used in the same minute is not counted again
 * (chat turns and recalls would otherwise rewrite the ledger on every query). Ranking and promotion depend on
 * wins, losses and lastUsed recency, none of which a same-minute repeat changes meaningfully.
 */
const usedThisMinute = (usage: NoteMeta['usage'], now: Date) => {
  const last = usage?.lastUsed ? Date.parse(usage.lastUsed) : NaN;
  return Number.isFinite(last) && Math.floor(last / 60_000) === Math.floor(now.getTime() / 60_000);
};
/** Provenance fields for a write; `host` defaults to this machine. Undefined fields are omitted. */
const originOf = (by: NoteOrigin | undefined): Pick<NoteMeta, 'host' | 'agent' | 'session'> => {
  const clean = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const host = clean(by?.host) ?? hostname(), agent = clean(by?.agent), session = clean(by?.session);
  return { ...(host ? { host } : {}), ...(agent ? { agent } : {}), ...(session ? { session } : {}) };
};
/** Log operation for a lifecycle update, or undefined when the update is not logged (no status change). */
const updateOp = (meta: NoteMeta, patch: Partial<NoteMeta>, authority?: string): LogOp | undefined => {
  if (authority === 'accept-canonical') return 'accept';
  if (authority === 'supersede-canonical' || authority === 'revert-decision') return 'supersede';
  if (!patch.status || patch.status === meta.status) return undefined;
  return meta.kind === 'session' && patch.status === 'closed' ? 'close-session' : `status:${patch.status}`;
};
const provenanceOf = (provenance: NoteProvenance | undefined): Partial<NoteMeta> =>
  Object.fromEntries(Object.entries(provenance ?? {}).filter(([, value]) => value !== undefined && (value as unknown) !== '' && !(Array.isArray(value) && !value.length)));
const pathExists = (path: string) => access(path).then(() => true, () => false);
const immutableCanonical = (meta: NoteMeta) => meta.tier === 'canonical' && (meta.status === 'accepted' || meta.status === 'superseded');

/** Free-text fields of a new note redacted with the title and body (ids, links and lifecycle fields are not free text). */
const NEW_NOTE_TEXT = ['tags', 'source', 'owner', 'stakeholder', 'provenance', 'by'] as const satisfies readonly (keyof NewNote)[];
/** Free-text frontmatter an update patch may carry. */
const META_TEXT = ['tags', 'source', 'owner', 'stakeholder', 'aliases', 'origin', 'albert', 'legacy_id', 'import_warning'] as const satisfies readonly (keyof NoteMeta)[];

/** Redacts the listed fields of `record` in place on a copy; returns the copy and the kinds found. */
function redactFields<T extends object>(record: T, keys: readonly (keyof T)[]): { record: T; kinds: string[] } {
  const out = { ...record }, kinds: string[] = [];
  for (const key of keys) {
    if (out[key] === undefined) continue;
    const result = redactValue(out[key]);
    out[key] = result.value;
    for (const kind of result.kinds) if (!kinds.includes(kind)) kinds.push(kind);
  }
  return { record: out, kinds };
}

/** Redacts secrets from a new note's title, body and free-text metadata; a redacted note is tagged `redacted`. */
function redactInput(input: NewNote): { input: NewNote; kinds: string[] } {
  const title = redactSecrets(input.title), body = redactSecrets(input.body), meta = redactFields(input, NEW_NOTE_TEXT);
  const kinds = [...new Set([...title.kinds, ...body.kinds, ...meta.kinds])];
  if (!kinds.length) return { input, kinds };
  return { input: { ...meta.record, title: title.text, body: body.text, tags: [...new Set([...(meta.record.tags ?? []), REDACTED_TAG])] }, kinds };
}

export function openBrain(locations: BrainLocation[], viewOptions: ViewOptions = {}): Brain {
  if (!locations.length) throw new Error('openBrain requires at least one location');
  const primary = locations[0]!;
  /** The location owning a file (by brain folder); the primary when none does. */
  const locationOf = (path: string) => locations.find(loc => isInside(brainPath(loc), path)) ?? primary;
  /** Notes as the rest of Edu sees them: frontmatter feedback merged with the root's exposure ledger. */
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
  const all = async () => withExposure(await overlayNotes(locations));
  const log = (note: Note, op: LogOp) => appendLog(brainPath(locationOf(note.path)), { op, id: note.meta.id, title: note.meta.title });
  /**
   * Where a usage/lifecycle write for this note belongs: lessons from a lower-priority location are shadowed in the
   * primary one. The destination never replaces a file holding a different note id: on a collision (same title,
   * imported ids) the shadow gets an id-derived file name instead.
   */
  const isolated = async (note: Note): Promise<Note> => {
    if (note.meta.tier !== 'transitive' || isInside(brainPath(primary), note.path)) return note;
    const preferred = notePath(brainPath(primary), note.meta, new Date(note.meta.created));
    const stem = `shadow-${slugify(note.meta.id)}`;
    for (const path of [preferred, join(dirname(preferred), `${stem}.md`), join(dirname(preferred), `${stem}-${createHash('sha256').update(note.meta.id).digest('hex').slice(0, 12)}.md`)]) {
      const occupant = await readNote(path);
      if (!occupant || occupant.meta.id === note.meta.id) return { ...note, path };
      if (!(await pathExists(path))) return { ...note, path };
    }
    throw new Error(`No safe shadow path for ${note.meta.id}`);
  };
  /** The location root that owns a file: the lock for a write is taken on the root actually written. */
  const rootOf = (path: string) => locationOf(path).root;
  /** Takes the usage lock of every distinct root, in a fixed order (no deadlock across processes), once each (never re-entrant). */
  const withRoots = async <T>(roots: string[], body: () => Promise<T>): Promise<T> => {
    // Canonical real paths: an alias or junction to the same root must not take the same lock twice (self-timeout),
    // and processes using either spelling must contend on the same directory.
    const canonical = await Promise.all(roots.map(async root => { await mkdir(resolve(root), { recursive: true }); return realpath(resolve(root)); }));
    const [first, ...rest] = [...new Map(canonical.map(root => [process.platform === 'win32' ? root.toLowerCase() : root, root])).values()].sort();
    if (first === undefined) return body();
    return withUsageLock(first, () => rest.length ? withRoots(rest, body) : body());
  };
  /** Persists lifecycle changes without discarding usage written meanwhile by another instance. */
  const persistFresh = (note: Note) => withRoots([rootOf(note.path), primary.root], async () => {
    const fresh = await readNote(note.path);
    return persist(await isolated(fresh?.meta.usage ? { ...note, meta: { ...note.meta, usage: fresh.meta.usage } } : note));
  });
  /** Retires the lesson a newer lesson supersedes. Accepted canonical notes are never touched. */
  const retireSuperseded = async (successor: Note, byId: Map<string, Note>): Promise<Note | undefined> => {
    const old = successor.meta.kind === 'lesson' && successor.meta.status !== 'retired' && successor.meta.supersedes ? byId.get(successor.meta.supersedes) : undefined;
    if (!old || old.meta.id === successor.meta.id || old.meta.tier !== 'transitive' || old.meta.kind !== 'lesson' || old.meta.status === 'retired' || old.meta.supersedes === successor.meta.id) return undefined;
    const retired = await persistFresh({ ...old, meta: { ...old.meta, status: 'retired', superseded_by: successor.meta.id, updated: iso() } });
    await log(retired, 'supersede');
    return retired;
  };
  const find = async (id: string) => (await all()).find(note => note.meta.id === id);
  /**
   * Keeps `0-index/catalog.md` fresh after a mutation: rebuilds the catalog of every location whose view includes a
   * changed file (its own location and the higher-priority ones that overlay it), under those roots' locks. Only the
   * catalog, not INDEX.md or the Obsidian views; `writeCatalog` leaves an unchanged catalog untouched. Must run after
   * the mutation's own locks are released (locks are not re-entrant). A failure is a warning, never a failed write.
   */
  let batchDepth = 0;
  let batchPaths: string[] = [];
  const refreshCatalogs = async (paths: string[]) => {
    if (batchDepth > 0) { batchPaths.push(...paths); return; }
    const deepest = Math.max(0, ...paths.map(path => locations.indexOf(locationOf(path))));
    const affected = locations.slice(0, deepest + 1);
    try {
      await withRoots(affected.map(loc => loc.root), async () => {
        for (const [index, loc] of affected.entries()) await writeCatalog(brainPath(loc), await overlayNotes(locations.slice(index)), note => note.meta.source !== REJECT_SOURCE);
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
    const disk = await readNote(note.path);
    const usage = frontmatterUsage(note.meta.usage, disk?.meta.usage, disk === undefined);
    const meta: NoteMeta = { ...note.meta };
    if (usage) meta.usage = usage; else delete meta.usage;
    // Refuses (throws) a note path that is, or sits under, a symbolic link inside the brain.
    await atomicWrite(note.path, encodeNote({ ...note, meta }), { root: brainPath(locationOf(note.path)) });
    return (await withExposure([{ ...note, meta: structuredClone(meta) }]))[0]!;
  };
  type Authority = 'accept-canonical' | 'supersede-canonical' | 'revert-decision';
  /**
   * Read, validate and persist run under the lock of the file's root (and the primary's), so two writers (hook,
   * MCP, another instance) cannot both confirm a transition such as closing a session. The note is re-read inside
   * the lock; if it moved to a root we do not hold, retry. Effects that follow (reverting a decision, retiring a
   * lesson) are separate transactions run by the caller after the lock is released: never nested.
   */
  const updateNote = async (id: string, patch: Partial<NoteMeta>, body: string | undefined, authority?: Authority, options: UpdateOptions = {}): Promise<Note> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const seen = await find(id); if (!seen) throw new Error(`Note not found: ${id}`);
      const roots = [rootOf(seen.path), primary.root];
      const done = await withRoots(roots, async () => {
        const current = await find(id); if (!current) throw new Error(`Note not found: ${id}`);
        if (!roots.includes(rootOf(current.path))) return undefined;
        return applyUpdate(current, patch, body, authority, options);
      });
      if (done) return done;
    }
    throw new Error(`Note could not settle on a stable location: ${id}`);
  };
  /** Must run under the lock of the note's root (callers use `withRoots`). */
  const applyUpdate = async (current: Note, patchIn: Partial<NoteMeta>, bodyIn: string | undefined, authority?: Authority, options: UpdateOptions = {}): Promise<Note> => {
    const id = current.meta.id;
    if (options.expectedHash !== undefined) {
      const currentHash = contentHash(current);
      if (options.expectedHash.trim().toLowerCase() !== currentHash) throw new NoteConflictError(id, options.expectedHash, currentHash);
    }
    const redacted = bodyIn === undefined ? undefined : redactSecrets(bodyIn);
    const body = redacted?.text ?? bodyIn;
    const metaRedacted = redactFields(patchIn, META_TEXT);
    const patch: Partial<NoteMeta> = metaRedacted.record;
    if ((redacted?.kinds.length || metaRedacted.kinds.length) && !(patch.tags ?? current.meta.tags).includes(REDACTED_TAG)) patch.tags = [...new Set([...(patch.tags ?? current.meta.tags), REDACTED_TAG])];
    const protectedKeys = new Set(['id', 'tier', 'kind', 'created', 'title', 'source', 'supersedes', 'updated', 'path', 'host', 'agent', 'session']);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) throw new Error(`Cannot clear '${key}' through update`);
      if (key === 'supersedes' && current.meta.kind === 'decision' && authority !== 'revert-decision') throw new Error('Decisions are immutable; create a new D- note with supersedes instead');
      if (protectedKeys.has(key) && !(key === 'supersedes' && authority === 'revert-decision')) throw new Error(`Note identity field '${key}' cannot be changed through update`);
    }
    if (isClosedEpisode(current.meta)) throw new Error('Closed episodic notes are immutable');
    if (current.meta.tier === 'canonical') {
      if ((current.meta.status === 'accepted' || current.meta.status === 'superseded') && (body !== undefined || Object.keys(patch).some(key => key !== 'status' && key !== 'updated'))) throw new Error('Accepted and superseded canonical notes are immutable');
      if (patch.status && authority !== 'accept-canonical' && authority !== 'supersede-canonical') throw new Error('Canonical lifecycle changes require acceptCanonical');
      if (authority === 'accept-canonical' && (current.meta.status !== 'proposed' || patch.status !== 'accepted')) throw new Error('Only a proposed canonical note can be accepted');
      if (authority === 'supersede-canonical' && (current.meta.status !== 'accepted' || patch.status !== 'superseded')) throw new Error('Only an accepted canonical note can be superseded');
    }
    if (current.meta.kind === 'decision') {
      if (body !== undefined || patch.title !== undefined || patch.supersedes !== undefined) throw new Error('Decisions are immutable; create a new D- note with supersedes instead');
      if (patch.status && (authority !== 'revert-decision' || patch.status !== 'reverted')) throw new Error('Decision status cannot be edited; create a new D- note with supersedes');
      if (patch.status === 'reverted') assertDecisionReversion(current.meta, patch);
    }
    if (patch.status && current.meta.kind) validateTransition(current.meta.tier === 'canonical' ? 'canonical' : current.meta.kind, current.meta.status, patch.status);
    // An explicit usage patch: feedback stays in the note, exposure goes to the ledger like any other exposure.
    if (patch.usage && (patch.usage.uses !== undefined || patch.usage.lastUsed !== undefined)) {
      const exposure = { uses: Number(patch.usage.uses) || 0, ...(patch.usage.lastUsed ? { lastUsed: patch.usage.lastUsed } : {}) };
      await updateLedger(rootOf(current.path), ledger => { ledger.notes[id] = exposure; return true; });
    }
    const origin = options.by ? originOf(options.by) : {};
    const meta = { ...current.meta, ...patch, ...origin, id: current.meta.id, tier: current.meta.tier, updated: iso() };
    if (options.by) for (const key of ['agent', 'session'] as const) if (!(key in origin)) delete meta[key];
    const written = await persist({ ...current, meta, body: body ?? current.body });
    const op = updateOp(current.meta, patch, authority);
    if (op) await log(written, op);
    return written;
  };

  /**
   * Exposure goes to each owning root's ledger under that root's usage lock; note files are never rewritten.
   * The first ledger entry of a note starts from its legacy frontmatter counters.
   */
  const markUsed = (candidates: Note[], now: Date) => withRoots(candidates.map(candidate => rootOf(candidate.path)), async () => {
    const byRoot = new Map<string, Note[]>();
    for (const candidate of candidates) byRoot.set(rootOf(candidate.path), [...(byRoot.get(rootOf(candidate.path)) ?? []), candidate]);
    for (const [root, group] of byRoot) {
      const disk = await Promise.all(group.map(async candidate => (await readNote(candidate.path)) ?? candidate));
      await updateLedger(root, ledger => {
        let changed = false;
        for (const note of disk) {
          if (isClosedEpisode(note.meta)) continue;
          const merged = mergeExposure(note.meta.usage, ledger.notes[note.meta.id]);
          if (usedThisMinute(merged, now)) continue;
          ledger.notes[note.meta.id] = nextExposure(merged, now); changed = true;
        }
        return changed;
      });
    }
  });

  return {
    async init(loc, opts = {}) {
      for (const folder of ['0-index', '1-canonical', '2-episodic', '3-transitive']) await mkdir(join(brainPath(loc), folder), { recursive: true });
      for (const folder of ['skills', 'agents', 'playbooks', 'proposals', 'runs']) await mkdir(join(loc.root, folder), { recursive: true });
      await ensureLocalIgnored(loc.root);
      try {
        const { resolveTemplatesDir } = await import('../adapters/index.js');
        const source = join(resolveTemplatesDir(), 'playbooks');
        for (const name of await readdir(source)) {
          if (!name.endsWith('.md')) continue;
          const target = join(loc.root, 'playbooks', name);
          try { await access(target); }
          catch { await atomicWrite(target, await readFile(join(source, name), 'utf8')); }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try { await access(join(loc.root, 'EDU.md')); }
      catch {
        let contract = fallbackEdu;
        try {
          const { resolveTemplatesDir } = await import('../adapters/index.js');
          contract = await readFile(join(resolveTemplatesDir(), 'EDU.md'), 'utf8');
        } catch { /* The bundled contract is optional for minimal installations. */ }
        contract = contract.replaceAll('{{name}}', opts.identityName ?? 'Edu');
        await atomicWrite(join(loc.root, 'EDU.md'), contract);
      }
    },
    async list(filter = {}) { return (await all()).filter(n => Object.entries(filter).every(([key, value]) => value === undefined || n.meta[key as keyof NoteMeta] === value)); },
    read: find,
    async resolve(reference) { return resolveReference(await all(), reference); },
    async write(raw) {
      const input = redactInput(raw).input;
      if (input.tier === 'canonical' && input.kind && !(['identity', 'standard', 'lexicon', 'domain', 'person', 'preference'] as CanonicalKind[]).includes(input.kind as CanonicalKind)) {
        throw new Error(`Invalid canonical kind: ${input.kind}`);
      }
      if (input.tier === 'canonical' && input.status && input.status !== 'proposed') throw new Error('Canonical notes must be written as proposed; use acceptCanonical for human confirmation');
      const now = new Date(input.created ?? Date.now());
      const meta: NoteMeta = {
        id: createId({ tier: input.tier, kind: input.kind, title: input.title, legacy_id: input.provenance?.legacy_id }, now), tier: input.tier, title: input.title,
        ...(input.kind ? { kind: input.kind } : {}), ...(input.tier === 'canonical' ? { status: 'proposed' as const } : input.status || defaultStatus(input.tier, input.kind) ? { status: input.status ?? defaultStatus(input.tier, input.kind) } : {}), ...(input.band ? { band: input.band } : {}),
        tags: [...new Set([...(input.tags ?? []), ...(input.kind ? [input.kind] : [])])], links: input.links ?? [], created: iso(now), updated: input.updated ? iso(new Date(input.updated)) : iso(now), source: input.source ?? 'user',
        ...(input.owner ? { owner: input.owner } : {}), ...(input.stakeholder ? { stakeholder: input.stakeholder } : {}), ...(input.due ? { due: input.due } : {}), ...(input.supersedes ? { supersedes: input.supersedes } : {}),
        ...provenanceOf(input.provenance), ...originOf(input.by),
      };
      if (meta.status && meta.kind) validateStatus(meta.tier === 'canonical' ? 'canonical' : meta.kind, meta.status);
      const path = notePath(brainPath(primary), meta, now);
      const note = { meta, body: input.body, path };
      // The existence check and the creation are one critical section: parallel identical identities cannot overwrite each other.
      let created: Note | undefined;
      const touched: string[] = [];
      if (meta.kind === 'decision' && meta.supersedes && !input.historical) {
        // Compound: validate the old decision is active -> create the new one -> revert the old, all under the locks of
        // the primary and the old decision's root (taken once, never nested). A competitor then finds the old one
        // already reverted and is rejected without effects. If reverting fails the new note is removed; this is
        // best effort, not a multi-file transaction (see report).
        for (let attempt = 0; attempt < 4 && !created; attempt++) {
          const seen = await find(meta.supersedes);
          if (!seen) throw new Error('A decision can supersede only an existing active decision');
          const roots = [primary.root, rootOf(seen.path)];
          created = await withRoots(roots, async () => {
            const prior = await find(meta.supersedes!);
            if (!prior || prior.meta.kind !== 'decision' || prior.meta.status !== 'active') throw new Error('A decision can supersede only an existing active decision');
            if (!roots.includes(rootOf(prior.path))) return undefined;
            if (await find(meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
            const fresh = await persist(note);
            try { await applyUpdate(prior, { status: 'reverted', superseded_by: fresh.meta.id }, undefined, 'revert-decision'); }
            catch (error) { await rm(fresh.path, { force: true }); throw error; }
            touched.push(prior.path);
            return fresh;
          });
        }
        if (!created) throw new Error(`Decision could not settle on a stable location: ${meta.supersedes}`);
      } else {
        created = await withRoots([primary.root], async () => {
          if (await find(meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
          return persist(note);
        });
      }
      // Open sessions are logged when they close; the decision a new one supersedes was logged by its revert.
      // An open session reaches the catalog when it closes (opening one on every session start would churn it).
      const openSession = meta.kind === 'session' && meta.status === 'open-session';
      if (!openSession) await log(created, 'write');
      if (meta.kind === 'lesson' && meta.supersedes) {
        const retired = await retireSuperseded(created, new Map((await all()).map(note => [note.meta.id, note])));
        if (retired) touched.push(retired.path);
      }
      if (!openSession) await refreshCatalogs([created.path, ...touched]);
      return created;
    },
    async remember(raw) {
      const { input, kinds } = redactInput(raw);
      const report: CompileReport = { linked: [], possibleConflicts: [], redacted: kinds };
      let links = input.links ?? [];
      if (input.tier === 'transitive' || input.tier === 'canonical') {
        const created = input.created ? new Date(input.created) : new Date();
        const draftMeta: NoteMeta = {
          id: createId({ tier: input.tier, kind: input.kind, title: input.title, legacy_id: input.provenance?.legacy_id }, created), tier: input.tier, title: input.title,
          ...(input.kind ? { kind: input.kind } : {}), status: input.tier === 'canonical' ? 'proposed' : input.status ?? defaultStatus(input.tier, input.kind),
          tags: input.tags ?? [], links, created: iso(created), ...(input.supersedes ? { supersedes: input.supersedes } : {}),
        };
        const compiled = compileNote({ meta: draftMeta, body: input.body, path: '' }, await all());
        links = compiled.links;
        report.linked = compiled.linked;
        report.possibleConflicts = compiled.possibleConflicts;
        if (compiled.suggestedSupersedes) report.suggestedSupersedes = compiled.suggestedSupersedes;
      }
      const note = await this.write({ ...input, links });
      return { note, report };
    },
    async update(id, patch, body, options) {
      const updated = await updateNote(id, patch, body, undefined, options);
      // A usage-only patch changes nothing the catalog lists.
      if (body !== undefined || Object.keys(patch).some(key => key !== 'usage' && key !== 'updated')) await refreshCatalogs([updated.path]);
      return updated;
    },
    async hashOf(id) {
      const note = await find(id);
      return note && contentHash(note);
    },
    async recall(query, opts = {}) {
      const notes = (await all()).filter(n => !opts.tiers || opts.tiers.includes(n.meta.tier));
      const hits = typeof query === 'string' ? rankNotes(query, notes, new Date(), opts.limit) : rankQueries(query, notes, new Date(), opts.limit);
      const now = new Date();
      await markUsed(hits.map(hit => hit.note), now);
      return hits;
    },
    async recordUse(ids, now = new Date()) {
      // One load for the whole batch: a find() per id reloaded the brain each time (quadratic on large imports).
      const byId = new Map((await all()).map(note => [note.meta.id, note]));
      await markUsed([...new Set(ids)].flatMap(id => byId.get(id) ?? []), now);
    },
    async feedback(id, helpful, context) {
      if (context !== undefined) assertFeedbackContext(context);
      let note = await find(id); if (!note) throw new Error(`Note not found: ${id}`);
      if (isClosedEpisode(note.meta)) throw new Error('Closed episodic notes are immutable');
      // Read, dedupe and persist under one exclusion on the roots involved (the file's root and the shadow's root),
      // so concurrent feedback or exposure from any project view never loses an event. The winner is re-read under
      // the lock; if it moved to a root we do not hold, retry with the right set.
      for (let attempt = 0; attempt < 4; attempt++) {
        const roots = [rootOf(note.path), primary.root];
        const done = await withRoots(roots, async () => {
          const current = await find(id); if (!current) throw new Error(`Note not found: ${id}`);
          if (!roots.includes(rootOf(current.path))) return undefined;
          if (isClosedEpisode(current.meta)) throw new Error('Closed episodic notes are immutable');
          const usage = feedbackUsage(current.meta.usage, helpful, new Date(), context);
          if (current.meta.usage && usage === current.meta.usage) return current; // same event already counted
          return persist(await isolated({ ...current, meta: { ...current.meta, usage, updated: iso() } }));
        });
        if (done) return done;
        note = (await find(id)) ?? note;
      }
      throw new Error(`Feedback could not settle on a stable note location: ${id}`);
    },
    async openSession(title, source, by) { return this.write({ title, body: '', tier: 'episodic', kind: 'session', status: 'open-session', source, ...(by ? { by } : {}) }); },
    async closeSession(id, summary, options) { return this.update(id, { status: 'closed' }, summary, options); },
    async proposeCanonical(input) {
      if (input.tier !== 'canonical') throw new Error('Canonical proposals must use tier canonical');
      return this.write({ ...input, status: 'proposed' });
    },
    async acceptCanonical(id) {
      // Validate, accept and supersede the old standard under the locks of every root involved (taken once, never nested).
      // A competitor accepting a second proposal of the same old note is rejected before any effect. A failure after the
      // first write restores the proposal best effort; this is not a multi-file transaction (see report).
      for (let attempt = 0; attempt < 4; attempt++) {
        const seen = await find(id); if (!seen || seen.meta.tier !== 'canonical') throw new Error(`Canonical note not found: ${id}`);
        const seenOld = seen.meta.supersedes ? await find(seen.meta.supersedes) : undefined;
        const roots = [rootOf(seen.path), primary.root, ...(seenOld ? [rootOf(seenOld.path)] : [])];
        const touched: string[] = [];
        const done = await withRoots(roots, async () => {
          const note = await find(id); if (!note || note.meta.tier !== 'canonical') throw new Error(`Canonical note not found: ${id}`);
          if (note.meta.status !== 'proposed') throw new Error('Only proposed canonical notes can be accepted');
          const old = note.meta.supersedes ? await find(note.meta.supersedes) : undefined;
          if (!roots.includes(rootOf(note.path)) || (old && !roots.includes(rootOf(old.path)))) return undefined;
          const replaces = old?.meta.tier === 'canonical' ? old : undefined;
          if (replaces?.meta.status === 'superseded') throw new Error(`Canonical note ${replaces.meta.id} was already superseded by another proposal`);
          const accepted = await applyUpdate(note, { status: 'accepted' }, undefined, 'accept-canonical');
          if (replaces?.meta.status === 'accepted') {
            try { await applyUpdate(replaces, { status: 'superseded' }, undefined, 'supersede-canonical'); }
            catch (error) { await persist(note); throw error; }
            touched.push(replaces.path);
          }
          return accepted;
        });
        if (done) { await refreshCatalogs([done.path, ...touched]); return done; }
      }
      throw new Error(`Canonical note could not settle on a stable location: ${id}`);
    },
    async rejectCanonical(id, reason) {
      const note = await find(id); if (!note || note.meta.tier !== 'canonical') throw new Error(`Canonical note not found: ${id}`);
      if (note.meta.status !== 'proposed') throw new Error('Only proposed canonical notes can be rejected');
      await rm(note.path, { force: true });
      await log(note, 'reject');
      const record = await this.write({
        tier: 'episodic', kind: 'session', status: 'open-session', source: REJECT_SOURCE, links: [id, ...note.meta.links],
        title: `Rejected canonical proposal: ${note.meta.title}`, body: '',
      });
      const quoted = note.body.trim().split('\n').slice(0, 12).map(line => `> ${line}`);
      await this.closeSession(record.meta.id, [`Rejected ${id} (${note.meta.band ?? 'inferred'}, source ${note.meta.source ?? 'unknown'}).`, ...(reason ? [`Reason: ${reason}`] : []), '', ...quoted].join('\n'));
      // Closing the record refreshed its catalog; the deleted proposal may have lived in a lower-priority location.
      if (rootOf(note.path) !== rootOf(record.path)) await refreshCatalogs([note.path]);
      return note;
    },
    async discardEmptySession(id) {
      const seen = await find(id); if (!seen) return false;
      const removed = await withRoots([rootOf(seen.path)], async () => {
        const current = await readNote(seen.path);
        if (!current || current.meta.id !== id || current.meta.tier !== 'episodic' || current.meta.kind !== 'session' || current.meta.status !== 'open-session' || current.body.trim()) return false;
        await rm(current.path, { force: true });
        return true;
      });
      // Open sessions enter a catalog only when another mutation rebuilt it meanwhile; rebuild only then.
      if (removed && (await readFile(join(brainPath(locationOf(seen.path)), INDEX_DIR, CATALOG_FILE), 'utf8').catch(() => '')).includes(id)) await refreshCatalogs([seen.path]);
      return removed;
    },
    async maintain(now = new Date()) {
      const report: MaintenanceReport = { changed: [], promoted: [], retired: [], overdue: [], indexRebuilt: false };
      // Load once per run (the loop used to reload the whole brain twice per note, which was quadratic on large imports).
      const loaded = await all();
      const byId = new Map(loaded.map(note => [note.meta.id, note]));
      // Lessons superseded by a newer lesson are retired first, so the loop below sees them already retired.
      for (const successor of loaded) {
        const retired = await retireSuperseded(successor, byId);
        if (!retired) continue;
        byId.set(retired.meta.id, retired); report.changed.push(retired.meta.id); report.retired.push(retired.meta.id);
      }
      const notes = loaded.map(note => byId.get(note.meta.id) ?? note);
      const proposedOrRejected = new Set<string>();
      const acceptedStandards = new Map<string, Note>();
      for (const candidate of notes) {
        if ((candidate.meta.tier === 'canonical' && candidate.meta.source === 'edu:maintain') || candidate.meta.source === REJECT_SOURCE) for (const link of candidate.meta.links) proposedOrRejected.add(link);
        if (candidate.meta.tier === 'canonical' && candidate.meta.kind === 'standard' && candidate.meta.status === 'accepted') acceptedStandards.set(candidate.meta.title, candidate);
      }
      for (const note of notes) {
        const next = applyLearning(note, now);
        if (next.meta.status === note.meta.status) continue;
        await log(await persistFresh(next), `maintain:${next.meta.status ?? 'unspecified'}`); report.changed.push(note.meta.id);
        if (next.meta.status === 'proven') report.promoted.push(note.meta.id);
        if (next.meta.status === 'retired') report.retired.push(note.meta.id);
        if (next.meta.status === 'overdue') report.overdue.push(note.meta.id);
        // Only a lesson promoted by THIS run is proposed; lessons that arrive already proven (imports, earlier runs) are not.
        if (next.meta.kind !== 'lesson' || next.meta.status !== 'proven' || proposedOrRejected.has(next.meta.id)) continue;
        const prior = acceptedStandards.get(next.meta.title);
        const proposal = await this.proposeCanonical({ tier: 'canonical', kind: 'standard', title: prior ? `${next.meta.title} (revision)` : next.meta.title, body: next.body, tags: next.meta.tags, links: [next.meta.id], source: 'edu:maintain', band: next.meta.band ?? 'inferred', ...(prior ? { supersedes: prior.meta.id } : {}) });
        for (const link of proposal.meta.links) proposedOrRejected.add(link);
      }
      await this.rebuildIndex(); report.indexRebuilt = true; return report;
    },
    async batch(work) {
      batchDepth++;
      try { return await work(); } finally {
        if (--batchDepth === 0 && batchPaths.length) { const paths = batchPaths; batchPaths = []; await refreshCatalogs(paths); }
      }
    },
    async rebuildIndex() {
      const notes = await all();
      const groups = new Map<string, Note[]>();
      for (const note of notes) { const key = `${note.meta.tier}/${note.meta.kind ?? 'other'}`; groups.set(key, [...(groups.get(key) ?? []), note]); }
      const lines = ['# Brain index', '', `Generated: ${iso()}`, ''];
      for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`## ${key}`, '');
        for (const note of group.sort((a, b) => a.meta.title.localeCompare(b.meta.title))) lines.push(`- [[${basename(note.path, '.md')}|${note.meta.title}]] — ${note.meta.band ?? 'inferred'} · ${note.meta.status ?? 'unspecified'}`);
        lines.push('');
      }
      try { await atomicWrite(join(brainPath(primary), INDEX_DIR, 'INDEX.md'), `${lines.join('\n')}\n`, { root: brainPath(primary) }); }
      catch (error) { warnUnsafe(error); }
      await writeCatalog(brainPath(primary), notes, note => note.meta.source !== REJECT_SOURCE);
      await writeObsidianViews(primary, viewOptions);
    },
    async move(id, targetRoot) {
      const target = locations.find(loc => resolve(loc.root) === resolve(targetRoot));
      if (!target) throw new Error(`Not a location of this brain: ${targetRoot}`);
      const seen = await find(id); if (!seen) throw new Error(`Note not found: ${id}`);
      const source = locationOf(seen.path);
      if (source === target) throw new Error(`${id} is already in the ${target.scope} brain (${target.root})`);
      const moved = await withRoots([source.root, target.root], async () => {
        const current = (await listLocation(source)).find(note => note.meta.id === id);
        if (!current) throw new Error(`Note not found in the ${source.scope} brain: ${id}`);
        if (current.meta.kind === 'session' && current.meta.status === 'open-session') throw new Error(`${id} is an open session; close it before moving it`);
        if ((await listLocation(target)).some(note => note.meta.id === id)) throw new Error(`Note id already exists in the ${target.scope} brain: ${id}; nothing was moved`);
        const path = notePath(brainPath(target), current.meta, new Date(current.meta.created));
        if (await pathExists(path)) throw new Error(`${path} already exists; nothing was moved`);
        await atomicWrite(path, await readFile(current.path, 'utf8'), { root: brainPath(target) });
        const copy = await readNote(path);
        if (copy?.meta.id !== id) { await rm(path, { force: true }); throw new Error(`The copy of ${id} in the ${target.scope} brain could not be read back; nothing was moved`); }
        const exposure = (await readLedger(source.root)).notes[id];
        if (exposure) {
          await updateLedger(target.root, ledger => { if (ledger.notes[id]) return false; ledger.notes[id] = exposure; return true; });
          await updateLedger(source.root, ledger => { delete ledger.notes[id]; return true; });
        }
        await rm(current.path);
        return copy;
      });
      for (const loc of [source, target]) await appendLog(brainPath(loc), { op: `move:${target.scope}`, id, title: moved.meta.title });
      for (const loc of [source, target]) {
        if (loc === primary) await this.rebuildIndex();
        else await writeCatalog(brainPath(loc), await overlayNotes(locations.slice(locations.indexOf(loc))), note => note.meta.source !== REJECT_SOURCE);
      }
      return (await withExposure([moved]))[0]!;
    },
    async stats() {
      const notes = await all();
      const result: BrainStats = { total: notes.length, byTier: { canonical: 0, episodic: 0, transitive: 0 }, byKind: {}, byStatus: {} };
      for (const note of notes) { result.byTier[note.meta.tier]++; if (note.meta.kind) result.byKind[note.meta.kind] = (result.byKind[note.meta.kind] ?? 0) + 1; if (note.meta.status) result.byStatus[note.meta.status] = (result.byStatus[note.meta.status] ?? 0) + 1; }
      return result;
    },
  };
}
