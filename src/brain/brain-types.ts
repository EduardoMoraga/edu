/** The public types of a brain: what `openBrain` returns and the options its methods take. */
import type { BrainLocation, ClaimBand, FeedbackContext, Note, NoteMeta, NoteOrigin, RecallHit, Tier } from '../core/contracts.js';
import type { CompileReport } from './compile.js';
import type { ResolveResult } from './resolve.js';
import type { NoteProblem } from './store.js';

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
/** Options of `Brain.recall`. */
export interface RecallOptions {
  limit?: number;
  tiers?: Tier[];
  /**
   * Record the hits as used (exposure). Default true. A caller that shows only some hits (a token budget) passes
   * false and records the ids it actually showed with `recordUse`.
   */
  recordUse?: boolean;
}
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
  recall(query: string | readonly string[], opts?: RecallOptions): Promise<RecallHit[]>;
  /**
   * Without `context` the feedback is advisory (counts as a ranking signal, never promotes). With a `context` it is
   * deduplicated by `eventId`; only trusted runtime callers may pass `verified: true` (MCP stays advisory).
   * When the note lives only in a lower-priority (global) location, a non-canonical lesson's updated copy is
   * written to the primary (project) location instead of mutating the global file.
   */
  feedback(id: string, helpful: boolean, context?: FeedbackContext): Promise<Note>;
  /**
   * Records that notes were used (injected into context). Exposure goes to the machine-local ledger
   * (`<root>/.edu-local/usage.json`), never to the note files; closed episodes are skipped. Pass the notes
   * themselves (e.g. recall hits) instead of ids to skip looking them up again.
   */
  recordUse(ids: ReadonlyArray<string | Note>, now?: Date): Promise<void>;
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
   * Files in the brain folders that could not be read as notes (invalid YAML, wrong field types, missing id, tier
   * or title, no frontmatter). They are quarantined: never loaded, never overwritten, reported here (lint, brief).
   * As of the latest full listing by this brain (`list`, `recall`, …); lists once when there was none yet.
   */
  problems(): Promise<NoteProblem[]>;
  /**
   * Moves a note to another location of this brain (e.g. project → global), keeping its id, file content and
   * frontmatter verbatim; its machine-local exposure follows it. Under the locks of both roots: refused when the
   * target already has the id (or the file), or for an open session. The target is written and read back first;
   * the source file is removed only after that. Both brains log `move:<target scope>` and get a fresh catalog.
   */
  move(id: string, targetRoot: string): Promise<Note>;
}
