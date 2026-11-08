/**
 * The dream plan file: Markdown a person reviews (one checkbox per proposal) with a fenced JSON block holding
 * the exact changes `edu dream --apply` runs. The checkboxes decide what is applied; the JSON decides how.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { BrainLocation } from '../core/contracts.js';
import { atomicWrite } from '../brain/index.js';
import { LINT_KINDS } from '../brain/lint.js';

export const DREAM_KINDS = ['new-lesson', 'promote-lesson', 'supersede', 'merge-duplicates', 'archive', 'fix-link', 'add-as-of'] as const;
export type DreamKind = (typeof DREAM_KINDS)[number];

const id = z.string().min(1);
const CANONICAL_KINDS = ['identity', 'standard', 'lexicon', 'domain', 'person', 'preference'] as const;
export const DreamChangeSchema = z.discriminatedUnion('op', [
  /** A new candidate lesson (band inferred, source edu:dream). */
  z.object({ op: z.literal('write-lesson'), title: z.string().min(1), body: z.string().min(1), links: z.array(id), tags: z.array(z.string()) }).strict(),
  /** A lifecycle transition, checked against `from` when applied. */
  z.object({ op: z.literal('set-status'), id, from: z.string().min(1), to: z.string().min(1), superseded_by: id.optional() }).strict(),
  /** A new decision superseding an active one (decisions are immutable: they change by replacement). */
  z.object({ op: z.literal('write-decision'), title: z.string().min(1), body: z.string().min(1), supersedes: id, links: z.array(id) }).strict(),
  /** A canonical proposal; it still waits for `edu brain approve`. */
  z.object({ op: z.literal('propose-canonical'), kind: z.enum(CANONICAL_KINDS), title: z.string().min(1), body: z.string().min(1), supersedes: id, links: z.array(id) }).strict(),
  /** Another name for an existing note, so a broken [[link]] resolves. */
  z.object({ op: z.literal('add-alias'), id, alias: z.string().min(1) }).strict(),
]);
export type DreamChange = z.infer<typeof DreamChangeSchema>;

export const DreamProposalSchema = z.object({
  id: z.string().regex(/^P-[a-f0-9]{8}$/),
  kind: z.enum(DREAM_KINDS),
  title: z.string().min(1),
  /** How many independent sessions (or notes) support it. */
  prevalence: z.number().int().nonnegative(),
  /** Session and note ids the proposal rests on; every one existed in the supplied evidence. */
  evidence: z.array(id).min(1),
  rationale: z.string().min(1),
  changes: z.array(DreamChangeSchema).min(1),
  origin: z.enum(['heuristic', 'model']),
  /** The checkbox: applied only when true. Claims a script cannot verify start unchecked. */
  checked: z.boolean(),
  applied: z.string().optional(),
}).strict();
export type DreamProposal = z.infer<typeof DreamProposalSchema>;

const FindingSchema = z.object({ kind: z.enum(LINT_KINDS), severity: z.enum(['error', 'warning', 'info']), ids: z.array(z.string()), message: z.string(), fix: z.string(), target: z.string().optional(), evidence: z.array(z.string()).optional() }).strict();

export const DreamPlanSchema = z.object({
  version: z.literal(1),
  generated: z.string(),
  /** Brain folder the plan was made for; applying it to another brain is refused. */
  brain: z.string(),
  days: z.number().int().positive(),
  sessions: z.number().int().nonnegative(),
  /** Closed sessions read, per source (claude, pi, codex…): episodes from every host share the brain. */
  hosts: z.record(z.string(), z.number().int().nonnegative()),
  model: z.object({ cli: z.string(), promptTokens: z.number().int().nonnegative(), proposed: z.number().int().nonnegative(), dropped: z.array(z.string()), deferred: z.number().int().nonnegative() }).strict().optional(),
  proposals: z.array(DreamProposalSchema),
  findings: z.array(FindingSchema),
}).strict();
export type DreamPlan = z.infer<typeof DreamPlanSchema>;

export const dreamPlanPath = (primary: BrainLocation) => join(primary.root, 'state', 'dream-plan.md');

const BLOCK_START = '<!-- edu:dream-plan — the JSON below is what --apply runs; review with the checkboxes above. -->';
const describeChange = (change: DreamChange): string => {
  switch (change.op) {
    case 'write-lesson': return `write candidate lesson "${change.title}" (inferred, edu:dream)`;
    case 'set-status': return `${change.id}: ${change.from} → ${change.to}${change.superseded_by ? ` (superseded by ${change.superseded_by})` : ''}`;
    case 'write-decision': return `new decision "${change.title}" superseding ${change.supersedes}`;
    case 'propose-canonical': return `propose canonical ${change.kind} "${change.title}" superseding ${change.supersedes} (waits for edu brain approve)`;
    case 'add-alias': return `${change.id}: add alias "${change.alias}"`;
  }
};
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function renderDreamPlan(plan: DreamPlan): string {
  const hosts = Object.entries(plan.hosts).sort(([a], [b]) => a.localeCompare(b)).map(([host, count]) => `${host} ${count}`).join(', ');
  const lines = [
    '# Edu dream plan', '',
    `- Generated: ${plan.generated}`,
    `- Brain: ${plan.brain}`,
    `- Window: last ${plan.days} days · ${plan.sessions} closed session(s)${hosts ? ` (${hosts})` : ''}`,
    `- Model: ${plan.model ? `${plan.model.cli} · ${plan.model.promptTokens} prompt tokens · ${plan.model.proposed} proposed · ${plan.model.dropped.length} dropped · ${plan.model.deferred} session(s) not sent` : 'none (deterministic)'}`,
    '',
    'Tick `[x]` what to apply and leave `[ ]` what to skip, then run `edu dream --apply`.',
    'Nothing is deleted: archiving sets a lifecycle status (retired, no-evidence); canonical changes stay proposals until `edu brain approve`.',
    '', '## Proposals', '',
  ];
  if (!plan.proposals.length) lines.push('Nothing to propose.', '');
  for (const p of plan.proposals) {
    lines.push(`- [${p.checked ? 'x' : ' '}] ${p.id} · ${p.kind} · ${oneLine(p.title)}${p.applied ? ` (applied ${p.applied})` : ''}`);
    lines.push(`  - Prevalence: ${p.prevalence} · Evidence: ${p.evidence.join(', ')} · Origin: ${p.origin}`);
    lines.push(`  - Why: ${oneLine(p.rationale)}`);
    for (const change of p.changes) lines.push(`  - Change: ${oneLine(describeChange(change))}`);
  }
  lines.push('', '## Lint findings (report only)', '');
  if (!plan.findings.length) lines.push('No findings.');
  else {
    lines.push('| Severity | Kind | Notes | Finding |', '|---|---|---|---|');
    for (const f of plan.findings) lines.push(`| ${f.severity} | ${f.kind} | ${f.ids.join(', ')} | ${oneLine(f.message).replace(/\|/g, '\\|')} |`);
  }
  lines.push('', BLOCK_START, '```json', JSON.stringify(plan, null, 2), '```', '');
  return lines.join('\n');
}

/** Reads the JSON block, then takes each proposal's `checked` from its checkbox line (a missing line means unchecked). */
export function parseDreamPlan(markdown: string, path = 'dream plan'): DreamPlan {
  const start = markdown.lastIndexOf(BLOCK_START);
  const block = start < 0 ? undefined : /```json\s*\n([\s\S]*?)\n```/.exec(markdown.slice(start))?.[1];
  if (!block) throw new Error(`Unreadable dream plan (no JSON block): ${path}`);
  let raw: unknown;
  try { raw = JSON.parse(block); } catch (error) { throw new Error(`Unreadable dream plan JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  const parsed = DreamPlanSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid dream plan ${path}: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`.trim());
  const boxes = new Map<string, boolean>();
  for (const match of markdown.slice(0, start).matchAll(/^- \[([ xX])\] (P-[a-f0-9]{8})\b/gm)) boxes.set(match[2]!, match[1] !== ' ');
  return { ...parsed.data, proposals: parsed.data.proposals.map(p => ({ ...p, checked: boxes.get(p.id) ?? false })) };
}

export async function saveDreamPlan(primary: BrainLocation, plan: DreamPlan): Promise<string> {
  const path = dreamPlanPath(primary);
  await atomicWrite(path, renderDreamPlan(plan));
  return path;
}

export async function loadDreamPlan(primary: BrainLocation): Promise<DreamPlan | undefined> {
  const path = dreamPlanPath(primary);
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  return raw === undefined ? undefined : parseDreamPlan(raw, path);
}
