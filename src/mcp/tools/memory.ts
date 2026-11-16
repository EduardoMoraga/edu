/** Memory tools: the brief, recall, reading and writing notes, feedback, canonical proposals and commitments. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contentHash } from '../../brain/index.js';
import { compileReportLines } from '../../brain/compile.js';
import { brief, estimateTokens, truncateToTokens } from '../../context/index.js';
import type { ClaimBand, Tier } from '../../core/contracts.js';
import { noteLine as line, type ToolContext } from './context.js';
import { altQueries, bands, canonicalKinds, optionalInt, tiers, tokenLimit, transitiveKinds } from './schema.js';

/** The trailer edu_recall prints for hits that did not fit its token budget. */
const moreHits = (count: number) => `… ${count} more hit${count === 1 ? '' : 's'} not shown (raise maxTokens, lower limit or narrow the query)`;

export function registerMemoryTools(ctx: ToolContext): void {
  const { register } = ctx;

  register('edu_brief', 'Session-start brief', { maxTokens: tokenLimit },
    async ({ maxTokens }) => brief(ctx.brain, maxTokens ?? 800, { eduMdPath: ctx.eduMdPath, now: ctx.opts.now }));

  register('edu_recall', 'Search notes', {
    query: z.string().min(1),
    alt: altQueries,
    limit: optionalInt(1), tiers: z.array(tiers).optional(), maxTokens: tokenLimit,
  }, async ({ query, alt, limit, tiers: selectedTiers, maxTokens }) => {
    const hits = await ctx.brain.recall(alt?.length ? [query, ...alt] : query, { limit: limit ?? 10, tiers: selectedTiers as Tier[] | undefined, recordUse: false });
    if (!hits.length) return 'No matching notes.';
    // Whole hits that fit the budget with room for the "N more" line; only the hits shown count as used.
    const budget = maxTokens ?? 800;
    const lines = hits.map(hit => `${line(hit.note)} · ${hit.why}`);
    let shown = 0, spent = 0;
    for (const text of lines) {
      const rest = lines.length - shown - 1;
      const cost = estimateTokens(text) + 1;
      if (spent + cost + (rest ? estimateTokens(moreHits(rest)) + 1 : 0) > budget) break;
      spent += cost; shown++;
    }
    // Not even the first hit fits whole: show it cut to the room left beside the trailer.
    if (!shown) { lines[0] = truncateToTokens(lines[0]!, Math.max(1, budget - (lines.length > 1 ? estimateTokens(moreHits(lines.length - 1)) + 1 : 0))); shown = 1; }
    await ctx.brain.recordUse(hits.slice(0, shown).map(hit => hit.note));
    return [...lines.slice(0, shown), ...(shown < lines.length ? [moreHits(lines.length - shown)] : [])].join('\n');
  });

  register('edu_read', 'Read a note by id, alias, id prefix, filename or title (ambiguous: lists candidates); shows its hash. Paged: pass offset from the hint; limit = chars per page', {
    id: z.string().min(1), offset: optionalInt(0), limit: optionalInt(1), maxTokens: tokenLimit,
  }, async ({ id, offset, limit, maxTokens }) => {
    const result = await ctx.brain.resolve(id);
    if (!result) throw new Error(`Note not found: ${id}`);
    if ('candidates' in result) return [`Ambiguous reference "${id}" (${result.via}): ${result.candidates.length} notes match. Read one by id:`, ...result.candidates.slice(0, 20).map(note => `- ${line(note)}`)].join('\n');
    const header = `${line(result.note)}\nhash: ${contentHash(result.note)}\n\n`;
    const body = result.note.body;
    const start = Math.min(offset ?? 0, body.length);
    const budget = maxTokens ?? 800;
    // Fit the page (header + text + continuation hint) in the token budget so the hint is never cut off.
    const render = (end: number) => `${header}${body.slice(start, end)}${end < body.length ? `\n\n[chars ${start}-${end} of ${body.length}; continue with edu_read id=${result.note.meta.id} offset=${end}]` : start > 0 ? `\n\n[chars ${start}-${end} of ${body.length}; end of note]` : ''}`;
    let end = Math.min(body.length, start + (limit ?? body.length));
    if (end >= body.length && start === 0 && estimateTokens(render(end)) <= budget) return render(end);
    while (end > start && estimateTokens(render(end)) > budget) end = start + Math.floor((end - start) * 0.9) - (end - start < 10 ? 1 : 0);
    return render(Math.max(start, end));
  });

  register('edu_remember', 'Write an episodic or transitive note; reports new links, possible conflicts, redactions', {
    tier: z.enum(['episodic', 'transitive']), kind: transitiveKinds.optional(), title: z.string().min(1), body: z.string(),
    band: bands.optional().describe('Claim band; required for transitive notes'), tags: z.array(z.string()).optional(), owner: z.string().optional(), due: z.string().optional(),
    links: z.array(z.string().min(1)).optional().describe('Related note ids'), supersedes: z.string().min(1).optional().describe('Id of the note this replaces'),
    session: z.string().min(1).optional().describe('Your Edu session id, if one was injected'),
    maxTokens: tokenLimit,
  }, async ({ tier, kind, title, body, band, tags, owner, due, links, supersedes, session }) => {
    if (tier === 'episodic' && kind) throw new Error('Episodic notes cannot use a transitive kind');
    // 6.0: a transitive note states how strongly it may be asserted; Edu never invents a band for it.
    if (tier === 'transitive' && !band) throw new Error('Invalid arguments: band is required for transitive notes: verified (backed by checked evidence), inferred (reasoned from evidence) or hypothesis (unproven)');
    const provenSession = await ctx.session.proven(session);
    const { note, report } = await ctx.brain.remember({
      tier, kind: tier === 'transitive' ? kind ?? 'lesson' : undefined, title, body, band: band as ClaimBand | undefined, tags, owner, due,
      ...(links?.length ? { links: [...new Set(links)] } : {}), ...(supersedes ? { supersedes } : {}), source: 'mcp', by: { ...ctx.by(), ...(provenSession ? { session: provenSession } : {}) },
    });
    return [`Created ${line(note)}`, ...compileReportLines(report), ...(session && !provenSession ? [`Session ${session} ignored: not an open session of this brain`] : [])].join('\n');
  });

  register('edu_feedback', 'Record whether a note helped (advisory; never marks anything externally verified)', {
    id: z.string().min(1), helpful: z.boolean(), maxTokens: tokenLimit,
  }, async ({ id, helpful }) => {
    // Advisory, and counted once per session, note and verdict: repeating the same opinion changes nothing.
    const eventId = `mcp:${createHash('sha256').update(`${ctx.session.current ?? ctx.session.serverSession}\n${id}\n${helpful}`).digest('hex').slice(0, 32)}`;
    const note = await ctx.brain.feedback(id, helpful, { eventId, verified: false });
    return `Feedback recorded: ${line(note)}`;
  });

  register('edu_propose_canonical', 'Propose a canonical note; a human must accept it', {
    kind: canonicalKinds, title: z.string().min(1), body: z.string(), band: bands.optional(), maxTokens: tokenLimit,
  }, async ({ kind, title, body, band }) => {
    const note = await ctx.brain.proposeCanonical({ tier: 'canonical', kind, title, body, band, source: 'mcp', by: ctx.by() });
    return `Proposed ${line(note)}`;
  });

  register('edu_commitments', 'List commitments', {
    status: z.enum(['pending', 'delivered', 'overdue']).optional(), maxTokens: tokenLimit,
  }, async ({ status }) => {
    const notes = await ctx.brain.list({ kind: 'commitment', ...(status ? { status } : {}) });
    return notes.length ? notes.sort((a, b) => (a.meta.due ?? '9999').localeCompare(b.meta.due ?? '9999')).map(note => `${line(note)} · due ${note.meta.due ?? 'unspecified'}`).join('\n') : 'No commitments.';
  });
}
