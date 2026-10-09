import type { CanonicalStatus, NoteMeta, TransitiveKind, TransitiveStatus } from '../core/contracts.js';

const transitions: Record<string, readonly string[]> = {
  decision: ['active', 'reverted'], hypothesis: ['open', 'confirmed', 'refuted', 'no-evidence'],
  commitment: ['pending', 'delivered', 'overdue'], lesson: ['candidate', 'proven', 'retired'],
  canonical: ['proposed', 'accepted', 'superseded'], session: ['open-session', 'closed'],
};

export function allowedStatuses(kind: NoteMeta['kind'] | 'canonical'): readonly string[] {
  return transitions[kind === undefined ? '' : kind] ?? [];
}

export function validateStatus(kind: NoteMeta['kind'] | 'canonical', status: string): void {
  if (!allowedStatuses(kind).includes(status)) throw new Error(`Invalid status '${status}' for kind '${kind ?? 'unknown'}'`);
}

export function validateTransition(kind: NoteMeta['kind'] | 'canonical', from: string | undefined, to: string): void {
  validateStatus(kind, to);
  if (from === to) return;
  const legal: Record<string, string[]> = {
    decision: ['active>reverted'], hypothesis: ['open>confirmed', 'open>refuted', 'open>no-evidence'],
    commitment: ['pending>delivered', 'pending>overdue', 'overdue>delivered'],
    lesson: ['candidate>proven', 'candidate>retired', 'proven>retired'],
    canonical: ['proposed>accepted', 'accepted>superseded'], session: ['open-session>closed'],
  };
  if (!(legal[kind ?? ''] ?? []).includes(`${from}>${to}`)) throw new Error(`Invalid lifecycle transition ${from ?? '(new)'} -> ${to} for ${kind ?? 'unknown'}`);
}

export function assertDecisionReversion(meta: NoteMeta, patch: Partial<NoteMeta>): void {
  if (meta.kind === 'decision' && patch.status === 'reverted' && (!patch.supersedes || patch.supersedes === meta.id)) {
    throw new Error('Reverting a decision requires a distinct superseding D- note; create the new decision with supersedes');
  }
}

export function isClosedEpisode(meta: NoteMeta): boolean {
  return meta.tier === 'episodic' && meta.status === 'closed';
}

export type { CanonicalStatus, TransitiveKind, TransitiveStatus };
