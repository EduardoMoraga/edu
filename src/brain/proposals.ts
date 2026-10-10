/**
 * Canonical proposals waiting for a human: listing with a one-line "why", and approve/reject over the
 * brain's own lifecycle (`acceptCanonical` / `rejectCanonical`). Used by `edu brain proposals|approve`.
 */
import type { Brain } from './brain.js';
import type { ClaimBand, Note } from '../core/contracts.js';

export interface CanonicalProposal { id: string; title: string; kind: string; source: string; band: ClaimBand; why: string; supersedes?: string; path: string }

/** Why a note is still proposed, derived from where it came from and how strongly it is claimed. */
export function proposalWhy(note: Note): string {
  const { meta } = note;
  const band = meta.band ?? 'inferred';
  const parts: string[] = [];
  if (meta.source === 'edu:maintain') parts.push(`promoted from proven lesson ${meta.links[0] ?? ''}`.trim());
  else if (meta.source?.startsWith('edu:reflect')) parts.push('suggested by edu reflect');
  else if (band === 'hypothesis') parts.push('hypothesis, not yet proven');
  else if (band === 'inferred') parts.push('interpretation, not stated explicitly in the source');
  else parts.push('needs human confirmation');
  if (meta.supersedes) parts.push(`would replace ${meta.supersedes}`);
  return parts.join('; ');
}

export async function listCanonicalProposals(brain: Pick<Brain, 'list'>): Promise<CanonicalProposal[]> {
  const notes = await brain.list({ tier: 'canonical', status: 'proposed' });
  return notes
    .sort((a, b) => a.meta.created.localeCompare(b.meta.created) || a.meta.id.localeCompare(b.meta.id))
    .map(note => ({
      id: note.meta.id, title: note.meta.title, kind: String(note.meta.kind ?? 'domain'), source: note.meta.source ?? 'unknown',
      band: note.meta.band ?? 'inferred', why: proposalWhy(note), ...(note.meta.supersedes ? { supersedes: note.meta.supersedes } : {}), path: note.path,
    }));
}

export interface ReviewResult { accepted: string[]; rejected: string[]; errors: Array<{ id: string; error: string }> }

/**
 * Accepts `approve` ids (or every pending proposal with `all`) and rejects `reject` ids. Rejections run first,
 * so `--all --reject X` approves everything except X. Each id is independent: one failure does not stop the rest.
 */
export async function reviewCanonicalProposals(
  brain: Pick<Brain, 'list' | 'acceptCanonical' | 'rejectCanonical'>,
  input: { approve?: string[]; all?: boolean; reject?: string[]; reason?: string },
): Promise<ReviewResult> {
  const result: ReviewResult = { accepted: [], rejected: [], errors: [] };
  const rejectIds = [...new Set(input.reject ?? [])];
  for (const id of rejectIds) {
    try { await brain.rejectCanonical(id, input.reason); result.rejected.push(id); }
    catch (error) { result.errors.push({ id, error: error instanceof Error ? error.message : String(error) }); }
  }
  const approveIds = input.all
    ? (await listCanonicalProposals(brain)).map(p => p.id).filter(id => !rejectIds.includes(id))
    : [...new Set(input.approve ?? [])];
  for (const id of approveIds) {
    try { await brain.acceptCanonical(id); result.accepted.push(id); }
    catch (error) { result.errors.push({ id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}
