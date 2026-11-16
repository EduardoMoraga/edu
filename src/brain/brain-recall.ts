/** Reading a brain: listing, lookup, recall with exposure tracking, stats and quarantined files. */
import type { Note, NoteMeta } from '../core/contracts.js';
import type { BrainCore } from './brain-core.js';
import type { Brain, BrainStats } from './brain-types.js';
import { mergeExposure, nextExposure, updateLedger } from './ledger.js';
import { isClosedEpisode } from './lifecycle.js';
import { resolveReference } from './resolve.js';
import { rankNotes, rankQueries } from './search.js';
import { contentHash, readNote } from './store.js';

/**
 * Exposure is a learning signal, not a log: a note already used in the same minute is not counted again
 * (chat turns and recalls would otherwise rewrite the ledger on every query). Ranking and promotion depend on
 * wins, losses and lastUsed recency, none of which a same-minute repeat changes meaningfully.
 */
const usedThisMinute = (usage: NoteMeta['usage'], now: Date) => {
  const last = usage?.lastUsed ? Date.parse(usage.lastUsed) : NaN;
  return Number.isFinite(last) && Math.floor(last / 60_000) === Math.floor(now.getTime() / 60_000);
};

export type RecallMethods = Pick<Brain, 'list' | 'read' | 'resolve' | 'hashOf' | 'recall' | 'recordUse' | 'stats' | 'problems'>;

export function recallMethods(core: BrainCore): RecallMethods {
  const { all, find, rootOf, withRoots } = core;
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
    async list(filter = {}) { return (await all()).filter(n => Object.entries(filter).every(([key, value]) => value === undefined || n.meta[key as keyof NoteMeta] === value)); },
    read: find,
    async resolve(reference) { return resolveReference(await all(), reference); },
    async hashOf(id) {
      const note = await find(id);
      return note && contentHash(note);
    },
    async recall(query, opts = {}) {
      const notes = (await all()).filter(n => !opts.tiers || opts.tiers.includes(n.meta.tier));
      const hits = typeof query === 'string' ? rankNotes(query, notes, new Date(), opts.limit) : rankQueries(query, notes, new Date(), opts.limit);
      if (opts.recordUse !== false) await markUsed(hits.map(hit => hit.note), new Date());
      return hits;
    },
    async recordUse(items, now = new Date()) {
      const ids = [...new Set(items.filter((item): item is string => typeof item === 'string'))];
      // One load for the whole batch: a find() per id reloaded the brain each time (quadratic on large imports).
      const byId = ids.length ? new Map((await all()).map(note => [note.meta.id, note])) : new Map<string, Note>();
      const given = new Map(items.filter((item): item is Note => typeof item !== 'string').map(note => [note.meta.id, note]));
      await markUsed([...given.values(), ...ids.filter(id => !given.has(id)).flatMap(id => byId.get(id) ?? [])], now);
    },
    problems: core.problems,
    async stats() {
      const notes = await all();
      const result: BrainStats = { total: notes.length, byTier: { canonical: 0, episodic: 0, transitive: 0 }, byKind: {}, byStatus: {} };
      for (const note of notes) { result.byTier[note.meta.tier]++; if (note.meta.kind) result.byKind[note.meta.kind] = (result.byKind[note.meta.kind] ?? 0) + 1; if (note.meta.status) result.byStatus[note.meta.status] = (result.byStatus[note.meta.status] ?? 0) + 1; }
      return result;
    },
  };
}
