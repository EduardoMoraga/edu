/**
 * How a brain learns and keeps itself in order: feedback on notes, maintenance (promote, retire, overdue, propose
 * proven lessons as standards) and the index rebuild. Every change is recomputed from the note as it is on disk.
 */
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { Note } from '../core/contracts.js';
import { REJECT_SOURCE, iso, pathExists, type BrainCore } from './brain-core.js';
import type { Brain, MaintenanceReport } from './brain-types.js';
import { warnUnsafe, writeCatalog } from './catalog.js';
import { applyLearning, assertFeedbackContext, feedbackUsage } from './learning.js';
import { isClosedEpisode, validateTransition } from './lifecycle.js';
import { brainPath, isInside } from './location.js';
import { INDEX_DIR, atomicWrite, inspectNote, notePath, readNote, slugify } from './store.js';
import { writeObsidianViews } from './views.js';

/** Retires the lesson a newer lesson supersedes; undefined when nothing changed. */
export type RetireSuperseded = (successor: Note, old: Note | undefined) => Promise<Note | undefined>;
export type MaintainMethods = Pick<Brain, 'feedback' | 'maintain' | 'rebuildIndex'>;

/** `self` is the assembled brain: maintenance proposes standards and rebuilds the index through it. */
export function maintainMethods(core: BrainCore, self: () => Brain): { methods: MaintainMethods; retireSuperseded: RetireSuperseded } {
  const { primary, find, all, log, persist, rootOf, withRoots, withExposure } = core;
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
      // A quarantined (unreadable) file is never replaced: only a free path or this note's own shadow will do.
      const occupant = await inspectNote(path);
      if (occupant ? 'note' in occupant && occupant.note.meta.id === note.meta.id : !(await pathExists(path))) return { ...note, path };
    }
    throw new Error(`No safe shadow path for ${note.meta.id}`);
  };
  /**
   * A lifecycle change computed from the note as it is now, never from an earlier snapshot: under the locks of its
   * root and the primary, the file is re-read (with its exposure), `change` is applied to that fresh copy and the
   * status transition is validated before anything is written. So a commitment delivered meanwhile is not turned
   * back to overdue, and its new body survives. Undefined when the note is gone, moved, or nothing changes; an
   * illegal transition (hand-edited status) is skipped with a warning.
   */
  const changeFresh = (seen: Note, change: (fresh: Note) => Note | undefined) => withRoots([rootOf(seen.path), primary.root], async () => {
    const disk = await readNote(seen.path);
    if (!disk || disk.meta.id !== seen.meta.id) return undefined;
    const fresh = (await withExposure([disk]))[0]!;
    const next = change(fresh);
    if (!next || next.meta.status === fresh.meta.status) return undefined;
    try {
      if (next.meta.status && fresh.meta.kind) validateTransition(fresh.meta.tier === 'canonical' ? 'canonical' : fresh.meta.kind, fresh.meta.status, next.meta.status);
    } catch (error) {
      process.emitWarning(`${fresh.meta.id} left unchanged: ${error instanceof Error ? error.message : String(error)}`, 'EduWarning');
      return undefined;
    }
    return persist(await isolated(next));
  });
  /** Retires the lesson a newer lesson supersedes, judged on the old lesson as it is now. Accepted canonical notes are never touched. */
  const retireSuperseded: RetireSuperseded = async (successor, old) => {
    if (successor.meta.kind !== 'lesson' || successor.meta.status === 'retired' || !old || old.meta.id === successor.meta.id) return undefined;
    const retired = await changeFresh(old, fresh => fresh.meta.tier !== 'transitive' || fresh.meta.kind !== 'lesson' || fresh.meta.status === 'retired' || fresh.meta.supersedes === successor.meta.id
      ? undefined : { ...fresh, meta: { ...fresh.meta, status: 'retired', superseded_by: successor.meta.id, updated: iso() } });
    if (retired) await log(retired, 'supersede');
    return retired;
  };

  const methods: MaintainMethods = {
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
    async maintain(now = new Date()) {
      const report: MaintenanceReport = { changed: [], promoted: [], retired: [], overdue: [], indexRebuilt: false };
      // Load once per run (the loop used to reload the whole brain twice per note, which was quadratic on large imports).
      const loaded = await all();
      const byId = new Map(loaded.map(note => [note.meta.id, note]));
      // Lessons superseded by a newer lesson are retired first, so the loop below sees them already retired.
      for (const successor of loaded) {
        const retired = successor.meta.supersedes ? await retireSuperseded(successor, byId.get(successor.meta.supersedes)) : undefined;
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
        // The snapshot only says which notes may change; the change itself is recomputed from the note as it is now.
        if (applyLearning(note, now).meta.status === note.meta.status) continue;
        const next = await changeFresh(note, fresh => applyLearning(fresh, now));
        if (!next) continue;
        await log(next, `maintain:${next.meta.status ?? 'unspecified'}`); report.changed.push(note.meta.id);
        if (next.meta.status === 'proven') report.promoted.push(note.meta.id);
        if (next.meta.status === 'retired') report.retired.push(note.meta.id);
        if (next.meta.status === 'overdue') report.overdue.push(note.meta.id);
        // Only a lesson promoted by THIS run is proposed; lessons that arrive already proven (imports, earlier runs) are not.
        if (next.meta.kind !== 'lesson' || next.meta.status !== 'proven' || proposedOrRejected.has(next.meta.id)) continue;
        const prior = acceptedStandards.get(next.meta.title);
        const proposal = await self().proposeCanonical({ tier: 'canonical', kind: 'standard', title: prior ? `${next.meta.title} (revision)` : next.meta.title, body: next.body, tags: next.meta.tags, links: [next.meta.id], source: 'edu:maintain', ...(next.meta.band ? { band: next.meta.band } : {}), ...(prior ? { supersedes: prior.meta.id } : {}) });
        for (const link of proposal.meta.links) proposedOrRejected.add(link);
      }
      await self().rebuildIndex(); report.indexRebuilt = true; return report;
    },
    async rebuildIndex() {
      const notes = await all();
      const groups = new Map<string, Note[]>();
      for (const note of notes) { const key = `${note.meta.tier}/${note.meta.kind ?? 'other'}`; groups.set(key, [...(groups.get(key) ?? []), note]); }
      const lines = ['# Brain index', '', `Generated: ${iso()}`, ''];
      for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`## ${key}`, '');
        for (const note of group.sort((a, b) => a.meta.title.localeCompare(b.meta.title))) lines.push(`- [[${basename(note.path, '.md')}|${note.meta.title}]] — ${note.meta.band ?? 'unbanded'} · ${note.meta.status ?? 'unspecified'}`);
        lines.push('');
      }
      try { await atomicWrite(join(brainPath(primary), INDEX_DIR, 'INDEX.md'), `${lines.join('\n')}\n`, { root: brainPath(primary) }); }
      catch (error) { warnUnsafe(error); }
      await writeCatalog(brainPath(primary), notes, core.liveReferrer);
      await writeObsidianViews(primary, core.viewOptions);
    },
  };
  return { methods, retireSuperseded };
}
