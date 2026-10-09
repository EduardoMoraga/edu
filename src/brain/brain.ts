import { access, mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { stringify } from 'yaml';
import type { BrainLocation, ClaimBand, Note, NoteMeta, RecallHit, Tier } from '../core/contracts.js';
import { INDEX_DIR, atomicWrite, createId, encodeNote, notePath, overlayNotes } from './store.js';
import { assertDecisionReversion, isClosedEpisode, validateTransition, validateStatus } from './lifecycle.js';
import { feedbackUsage, applyLearning, recordUsage } from './learning.js';
import { rankNotes } from './search.js';

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
  due?: string;
  supersedes?: string;
  created?: string;
}
export interface MaintenanceReport { changed: string[]; promoted: string[]; retired: string[]; overdue: string[]; indexRebuilt: boolean }
export interface BrainStats { total: number; byTier: Record<Tier, number>; byKind: Record<string, number>; byStatus: Record<string, number> }

export interface Brain {
  init(loc: BrainLocation, opts?: { identityName?: string }): Promise<void>;
  list(filter?: Partial<Pick<NoteMeta, 'tier' | 'kind' | 'status'>>): Promise<Note[]>;
  read(id: string): Promise<Note | undefined>;
  write(input: NewNote): Promise<Note>;
  update(id: string, patch: Partial<NoteMeta>, body?: string): Promise<Note>;
  recall(query: string, opts?: { limit?: number; tiers?: Tier[] }): Promise<RecallHit[]>;
  feedback(id: string, helpful: boolean): Promise<Note>;
  openSession(title: string, source: string): Promise<Note>;
  closeSession(id: string, summary: string): Promise<Note>;
  proposeCanonical(input: NewNote): Promise<Note>;
  acceptCanonical(id: string): Promise<Note>;
  maintain(now?: Date): Promise<MaintenanceReport>;
  rebuildIndex(): Promise<void>;
  stats(): Promise<BrainStats>;
}

const fallbackEdu = `# EDU\n\nEdu is the durable, engine-independent memory contract.\n\n- Keep canonical notes human-confirmed.\n- Never edit closed session notes.\n- Record decisions as new notes when they change.\n`;
const iso = (d = new Date()) => d.toISOString();
const defaultStatus = (tier: Tier, kind: NoteMeta['kind']): NoteMeta['status'] => tier === 'canonical' ? 'proposed' : ({ decision: 'active', hypothesis: 'open', commitment: 'pending', lesson: 'candidate', session: 'open-session' } as const)[kind as 'decision' | 'hypothesis' | 'commitment' | 'lesson' | 'session'];
const immutableCanonical = (meta: NoteMeta) => meta.tier === 'canonical' && (meta.status === 'accepted' || meta.status === 'superseded');

export function openBrain(locations: BrainLocation[]): Brain {
  if (!locations.length) throw new Error('openBrain requires at least one location');
  const primary = locations[0]!;
  const all = () => overlayNotes(locations);
  const find = async (id: string) => (await all()).find(note => note.meta.id === id);
  const persist = async (note: Note) => { await atomicWrite(note.path, encodeNote(note)); return note; };
  const updateNote = async (id: string, patch: Partial<NoteMeta>, body: string | undefined, authority?: 'accept-canonical' | 'supersede-canonical' | 'revert-decision'): Promise<Note> => {
    const current = await find(id); if (!current) throw new Error(`Note not found: ${id}`);
    const protectedKeys = new Set(['id', 'tier', 'kind', 'created', 'title', 'source', 'supersedes', 'updated', 'path']);
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
      if (body !== undefined || patch.title !== undefined || (patch.supersedes !== undefined && authority !== 'revert-decision')) throw new Error('Decisions are immutable; create a new D- note with supersedes instead');
      if (patch.status && (authority !== 'revert-decision' || patch.status !== 'reverted')) throw new Error('Decision status cannot be edited; create a new D- note with supersedes');
      if (patch.status === 'reverted') assertDecisionReversion(current.meta, patch);
    }
    if (patch.status && current.meta.kind) validateTransition(current.meta.tier === 'canonical' ? 'canonical' : current.meta.kind, current.meta.status, patch.status);
    const meta = { ...current.meta, ...patch, id: current.meta.id, tier: current.meta.tier, updated: iso() };
    return persist({ ...current, meta, body: body ?? current.body });
  };

  return {
    async init(loc, opts = {}) {
      for (const folder of ['brain/0-index', 'brain/1-canonical', 'brain/2-episodic', 'brain/3-transitive', 'skills', 'agents', 'proposals', 'runs']) await mkdir(join(loc.root, folder), { recursive: true });
      try { await access(join(loc.root, 'EDU.md')); }
      catch {
        let contract = fallbackEdu;
        try { contract = await readFile(join(process.cwd(), 'templates/EDU.md'), 'utf8'); } catch { /* template is optional */ }
        if (opts.identityName) contract = contract.replace('# EDU', `# ${opts.identityName}`);
        await atomicWrite(join(loc.root, 'EDU.md'), contract);
      }
    },
    async list(filter = {}) { return (await all()).filter(n => Object.entries(filter).every(([key, value]) => value === undefined || n.meta[key as keyof NoteMeta] === value)); },
    read: find,
    async write(input) {
      if (input.tier === 'canonical' && input.status && input.status !== 'proposed') throw new Error('Canonical notes must be written as proposed; use acceptCanonical for human confirmation');
      const now = new Date(input.created ?? Date.now());
      const meta: NoteMeta = {
        id: createId({ tier: input.tier, kind: input.kind, title: input.title }, now), tier: input.tier, title: input.title,
        ...(input.kind ? { kind: input.kind } : {}), ...(input.tier === 'canonical' ? { status: 'proposed' as const } : input.status || defaultStatus(input.tier, input.kind) ? { status: input.status ?? defaultStatus(input.tier, input.kind) } : {}), ...(input.band ? { band: input.band } : {}),
        tags: [...new Set([...(input.tags ?? []), ...(input.kind ? [input.kind] : [])])], links: input.links ?? [], created: iso(now), updated: iso(now), source: input.source ?? 'user',
        ...(input.owner ? { owner: input.owner } : {}), ...(input.due ? { due: input.due } : {}), ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      };
      if (meta.status && meta.kind) validateStatus(meta.tier === 'canonical' ? 'canonical' : meta.kind, meta.status);
      const path = notePath(primary.root, meta, now);
      const note = { meta, body: input.body, path };
      let priorDecision: Note | undefined;
      if (meta.kind === 'decision' && meta.supersedes) {
        priorDecision = await find(meta.supersedes);
        if (!priorDecision || priorDecision.meta.kind !== 'decision' || priorDecision.meta.status !== 'active') throw new Error('A decision can supersede only an existing active decision');
      }
      if (await find(meta.id)) throw new Error(`Note id already exists: ${meta.id}`);
      const created = await persist(note);
      if (priorDecision) await updateNote(priorDecision.meta.id, { status: 'reverted', supersedes: created.meta.id }, undefined, 'revert-decision');
      return created;
    },
    async update(id, patch, body) {
      return updateNote(id, patch, body);
    },
    async recall(query, opts = {}) {
      const notes = (await all()).filter(n => !opts.tiers || opts.tiers.includes(n.meta.tier));
      const hits = rankNotes(query, notes, new Date(), opts.limit);
      for (const hit of hits) if (!isClosedEpisode(hit.note.meta)) await persist({ ...hit.note, meta: { ...hit.note.meta, usage: recordUsage(hit.note.meta.usage), updated: iso() } });
      return hits;
    },
    async feedback(id, helpful) {
      const note = await find(id); if (!note) throw new Error(`Note not found: ${id}`);
      if (isClosedEpisode(note.meta)) throw new Error('Closed episodic notes are immutable');
      return persist({ ...note, meta: { ...note.meta, usage: feedbackUsage(note.meta.usage, helpful), updated: iso() } });
    },
    async openSession(title, source) { return this.write({ title, body: '', tier: 'episodic', kind: 'session', status: 'open-session', source }); },
    async closeSession(id, summary) { return this.update(id, { status: 'closed' }, summary); },
    async proposeCanonical(input) {
      if (input.tier !== 'canonical') throw new Error('Canonical proposals must use tier canonical');
      return this.write({ ...input, status: 'proposed' });
    },
    async acceptCanonical(id) {
      const note = await find(id); if (!note || note.meta.tier !== 'canonical') throw new Error(`Canonical note not found: ${id}`);
      if (note.meta.status !== 'proposed') throw new Error('Only proposed canonical notes can be accepted');
      const accepted = await updateNote(id, { status: 'accepted' }, undefined, 'accept-canonical');
      if (accepted.meta.supersedes) {
        const old = await find(accepted.meta.supersedes);
        if (old?.meta.tier === 'canonical' && old.meta.status === 'accepted') await updateNote(old.meta.id, { status: 'superseded' }, undefined, 'supersede-canonical');
      }
      return accepted;
    },
    async maintain(now = new Date()) {
      const report: MaintenanceReport = { changed: [], promoted: [], retired: [], overdue: [], indexRebuilt: false };
      for (const note of await all()) {
        const next = applyLearning(note, now);
        if (next.meta.status !== note.meta.status) {
          await persist(next); report.changed.push(note.meta.id);
          if (next.meta.status === 'proven') report.promoted.push(note.meta.id);
          if (next.meta.status === 'retired') report.retired.push(note.meta.id);
          if (next.meta.status === 'overdue') report.overdue.push(note.meta.id);
        }
        if (next.meta.kind === 'lesson' && next.meta.status === 'proven') {
          const proposalExists = (await all()).some(candidate => candidate.meta.tier === 'canonical' && candidate.meta.source === 'edu:maintain' && candidate.meta.links.includes(next.meta.id));
          if (!proposalExists) {
            const prior = (await all()).find(candidate => candidate.meta.tier === 'canonical' && candidate.meta.kind === 'standard' && candidate.meta.title === next.meta.title && candidate.meta.status === 'accepted');
            await this.proposeCanonical({ tier: 'canonical', kind: 'standard', title: prior ? `${next.meta.title} (revision)` : next.meta.title, body: next.body, tags: next.meta.tags, links: [next.meta.id], source: 'edu:maintain', band: next.meta.band ?? 'inferred', ...(prior ? { supersedes: prior.meta.id } : {}) });
          }
        }
      }
      await this.rebuildIndex(); report.indexRebuilt = true; return report;
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
      await atomicWrite(join(primary.root, 'brain', INDEX_DIR, 'INDEX.md'), `${lines.join('\n')}\n`);
      for (const [kind, file, props] of [
        ['lesson', 'Lessons.base', ['title', 'status', 'tags', 'usage.wins', 'usage.losses']],
        ['commitment', 'Commitments.base', ['title', 'status', 'owner', 'due', 'tags']],
        ['hypothesis', 'Hypotheses.base', ['title', 'status', 'band', 'tags']],
        ['session', 'Sessions.base', ['title', 'status', 'created', 'source']],
      ] as const) {
        const folder = kind === 'session' ? '2-episodic' : kind === 'lesson' || kind === 'commitment' || kind === 'hypothesis' ? '3-transitive' : '';
        const content = stringify({ filters: { and: [`file.inFolder("brain/${folder}")`, `file.hasTag("${kind}")`] }, views: [{ type: 'table', name: kind[0]!.toUpperCase() + kind.slice(1), order: props.map(prop => prop.startsWith('usage.') ? `note.${prop}` : `note.${prop}`) }] });
        await atomicWrite(join(primary.root, 'brain', INDEX_DIR, file), content);
      }
    },
    async stats() {
      const notes = await all();
      const result: BrainStats = { total: notes.length, byTier: { canonical: 0, episodic: 0, transitive: 0 }, byKind: {}, byStatus: {} };
      for (const note of notes) { result.byTier[note.meta.tier]++; if (note.meta.kind) result.byKind[note.meta.kind] = (result.byKind[note.meta.kind] ?? 0) + 1; if (note.meta.status) result.byStatus[note.meta.status] = (result.byStatus[note.meta.status] ?? 0) + 1; }
      return result;
    },
  };
}
