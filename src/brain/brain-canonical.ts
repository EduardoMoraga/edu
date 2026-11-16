/**
 * Canonical review: proposals wait for a person, who accepts them (superseding the standard they revise) or rejects
 * them (the proposal is deleted and a closed episodic record keeps what was rejected and why).
 */
import { rm } from 'node:fs/promises';
import type { Note } from '../core/contracts.js';
import { REJECT_SOURCE, type BrainCore } from './brain-core.js';
import type { Brain } from './brain-types.js';
import type { ApplyUpdate } from './brain-write.js';

export type CanonicalMethods = Pick<Brain, 'proposeCanonical' | 'acceptCanonical' | 'rejectCanonical'>;

/** `self` is the assembled brain: proposals and the rejection record are written through it. */
export function canonicalMethods(core: BrainCore, self: () => Brain, applyUpdate: ApplyUpdate): CanonicalMethods {
  const { primary, find, rootOf, withRoots, persist, log, refreshCatalogs } = core;
  return {
    async proposeCanonical(input) {
      if (input.tier !== 'canonical') throw new Error('Canonical proposals must use tier canonical');
      return self().write({ ...input, status: 'proposed' });
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
      // Check and delete under the lock of the proposal's root: a concurrent accept (same lock) either wins first,
      // and the proposal is no longer rejectable, or finds it gone.
      let note: Note | undefined;
      for (let attempt = 0; attempt < 4 && !note; attempt++) {
        const seen = await find(id); if (!seen || seen.meta.tier !== 'canonical') throw new Error(`Canonical note not found: ${id}`);
        const root = rootOf(seen.path);
        note = await withRoots([root], async () => {
          const current = await find(id); if (!current || current.meta.tier !== 'canonical') throw new Error(`Canonical note not found: ${id}`);
          if (rootOf(current.path) !== root) return undefined;
          if (current.meta.status !== 'proposed') throw new Error('Only proposed canonical notes can be rejected');
          await rm(current.path, { force: true });
          return current;
        });
      }
      if (!note) throw new Error(`Canonical note could not settle on a stable location: ${id}`);
      await log(note, 'reject');
      const record = await self().write({
        tier: 'episodic', kind: 'session', status: 'open-session', source: REJECT_SOURCE, links: [id, ...note.meta.links],
        title: `Rejected canonical proposal: ${note.meta.title}`, body: '',
      });
      const quoted = note.body.trim().split('\n').slice(0, 12).map(line => `> ${line}`);
      await self().closeSession(record.meta.id, [`Rejected ${id} (${note.meta.band ?? 'unbanded'}, source ${note.meta.source ?? 'unknown'}).`, ...(reason ? [`Reason: ${reason}`] : []), '', ...quoted].join('\n'));
      // Closing the record refreshed its catalog; the deleted proposal may have lived in a lower-priority location.
      if (rootOf(note.path) !== rootOf(record.path)) await refreshCatalogs([note.path]);
      return note;
    },
  };
}
