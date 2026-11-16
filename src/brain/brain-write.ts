/**
 * Writing to a brain and the note lifecycle: initializing a location, creating and compiling notes, guarded updates,
 * sessions, moves between locations and write batches.
 */
import { access, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CanonicalKind, Note, NoteMeta, Tier } from '../core/contracts.js';
import { META_TEXT, iso, originOf, redactFields, redactInput, type BrainCore } from './brain-core.js';
import type { RetireSuperseded } from './brain-maintain.js';
import type { Brain, NoteProvenance, UpdateOptions } from './brain-types.js';
import { CATALOG_FILE, appendLog, writeCatalog, type LogOp } from './catalog.js';
import { cleanBody } from './clean-text.js';
import { compileNote, type CompileReport } from './compile.js';
import { ensureLocalIgnored, readLedger, updateLedger } from './ledger.js';
import { assertDecisionReversion, isClosedEpisode, validateStatus, validateTransition } from './lifecycle.js';
import { brainPath } from './location.js';
import { REDACTED_TAG, redactSecrets } from './redact.js';
import { INDEX_DIR, NoteConflictError, atomicWrite, contentHash, createId, exclusiveWrite, isAlreadyExists, listLocation, notePath, overlayNotes, readNote } from './store.js';

const fallbackEdu = `# EDU\n\nEdu is the durable, engine-independent memory contract.\n\n- Keep canonical notes human-confirmed.\n- Never edit closed session notes.\n- Record decisions as new notes when they change.\n`;
const defaultStatus = (tier: Tier, kind: NoteMeta['kind']): NoteMeta['status'] => tier === 'canonical' ? 'proposed' : ({ decision: 'active', hypothesis: 'open', commitment: 'pending', lesson: 'candidate', session: 'open-session' } as const)[kind as 'decision' | 'hypothesis' | 'commitment' | 'lesson' | 'session'];
/** Log operation for a lifecycle update, or undefined when the update is not logged (no status change). */
const updateOp = (meta: NoteMeta, patch: Partial<NoteMeta>, authority?: string): LogOp | undefined => {
  if (authority === 'accept-canonical') return 'accept';
  if (authority === 'supersede-canonical' || authority === 'revert-decision') return 'supersede';
  if (!patch.status || patch.status === meta.status) return undefined;
  return meta.kind === 'session' && patch.status === 'closed' ? 'close-session' : `status:${patch.status}`;
};
const provenanceOf = (provenance: NoteProvenance | undefined): Partial<NoteMeta> =>
  Object.fromEntries(Object.entries(provenance ?? {}).filter(([, value]) => value !== undefined && (value as unknown) !== '' && !(Array.isArray(value) && !value.length)));

/** Who may make a lifecycle change `update` itself refuses: accepting or superseding canonical notes, reverting a decision. */
export type Authority = 'accept-canonical' | 'supersede-canonical' | 'revert-decision';
/** Applies a validated update to a note read under its root's lock (callers hold it). */
export type ApplyUpdate = (current: Note, patch: Partial<NoteMeta>, body: string | undefined, authority?: Authority, options?: UpdateOptions) => Promise<Note>;
export type WriteMethods = Pick<Brain, 'init' | 'write' | 'remember' | 'update' | 'openSession' | 'closeSession' | 'discardEmptySession' | 'move' | 'batch'>;

/** `self` is the assembled brain: compound writes (remember, sessions, move) go through its methods. */
export function writeMethods(core: BrainCore, self: () => Brain, retireSuperseded: RetireSuperseded): { methods: WriteMethods; applyUpdate: ApplyUpdate } {
  const { locations, primary, find, locationOf, rootOf, withRoots, persist, createNote, log, refreshCatalogs, withExposure } = core;
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
  const applyUpdate: ApplyUpdate = async (current, patchIn, bodyIn, authority, options = {}) => {
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

  const methods: WriteMethods = {
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
      // An open session reaches the catalog when it closes (opening one on every session start would churn it).
      const openSession = meta.kind === 'session' && meta.status === 'open-session';
      let cataloged = false;
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
            if ((await overlayNotes(locations)).some(other => other.meta.id === meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
            const fresh = await createNote(note);
            try { await applyUpdate(prior, { status: 'reverted', superseded_by: fresh.meta.id }, undefined, 'revert-decision'); }
            catch (error) { await rm(fresh.path, { force: true }); throw error; }
            touched.push(prior.path);
            return fresh;
          });
        }
        if (!created) throw new Error(`Decision could not settle on a stable location: ${meta.supersedes}`);
      } else {
        created = await withRoots([primary.root], async () => {
          // One listing serves the id check and, when nothing else changes, the primary's catalog (same lock).
          const before = await overlayNotes(locations);
          if (before.some(other => other.meta.id === meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
          const fresh = await createNote(note);
          if (!openSession && !core.batching && !(meta.kind === 'lesson' && meta.supersedes)) cataloged = await core.catalogSafely(primary, [...before, fresh]);
          return fresh;
        });
      }
      // Open sessions are logged when they close; the decision a new one supersedes was logged by its revert.
      if (!openSession) await log(created, 'write');
      if (meta.kind === 'lesson' && meta.supersedes) {
        const retired = await retireSuperseded(created, await find(meta.supersedes));
        if (retired) touched.push(retired.path);
      }
      if (!openSession && !cataloged) await refreshCatalogs([created.path, ...touched]);
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
        const compiled = compileNote({ meta: draftMeta, body: input.body, path: '' }, await core.all());
        links = compiled.links;
        report.linked = compiled.linked;
        report.possibleConflicts = compiled.possibleConflicts;
        if (compiled.suggestedSupersedes) report.suggestedSupersedes = compiled.suggestedSupersedes;
      }
      const note = await self().write({ ...input, links });
      return { note, report };
    },
    async update(id, patch, body, options) {
      const updated = await updateNote(id, patch, body === undefined ? undefined : cleanBody(body), undefined, options);
      // A usage-only patch changes nothing the catalog lists.
      if (body !== undefined || Object.keys(patch).some(key => key !== 'usage' && key !== 'updated')) await refreshCatalogs([updated.path]);
      return updated;
    },
    async openSession(title, source, by) { return self().write({ title, body: '', tier: 'episodic', kind: 'session', status: 'open-session', source, ...(by ? { by } : {}) }); },
    async closeSession(id, summary, options) { return self().update(id, { status: 'closed' }, summary, options); },
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
    batch: core.batch,
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
        try { await exclusiveWrite(path, await readFile(current.path, 'utf8'), { root: brainPath(target) }); }
        catch (error) { if (isAlreadyExists(error)) throw new Error(`${path} already exists; nothing was moved`); throw error; }
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
        if (loc === primary) await self().rebuildIndex();
        else await writeCatalog(brainPath(loc), await overlayNotes(locations.slice(locations.indexOf(loc))), core.liveReferrer);
      }
      return (await withExposure([moved]))[0]!;
    },
  };
  return { methods, applyUpdate };
}
