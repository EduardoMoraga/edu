import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { OutcomeLabel } from '../core/contracts.js';

const labels = ['autonomous_verified_success', 'assisted_verified_success', 'unverified_success', 'failed', 'unsafe_invalid'] as const;
const taskSchema = z.object({ requirements: z.array(z.object({ id: z.string().min(1), text: z.string().optional() })) });
const verificationSchema = z.object({
  type: z.literal('verify.result'), requirementIds: z.array(z.string().min(1)), ok: z.boolean(),
  kind: z.enum(['reproduction', 'deterministic', 'targeted-test', 'regression', 'lint', 'review']),
  checkId: z.string().optional(), method: z.string().optional(), output: z.string().optional(),
  at: z.string().optional(), exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().finite().nonnegative().optional(), timedOut: z.boolean().optional(),
});
const outcomeSchema = z.object({
  type: z.enum(['outcome', 'run.end']).optional(), label: z.enum(labels).optional(), ok: z.boolean().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(), at: z.string().optional(),
}).refine(value => (value.label !== undefined || value.ok !== undefined)
  && (value.type !== 'run.end' || value.ok !== undefined) && (value.type !== 'outcome' || value.label !== undefined));
const entropySchema = z.object({ findings: z.array(z.object({ category: z.string(), severity: z.number().int().min(0).max(3) })) });
const interventionSchema = z.object({
  type: z.enum(['intervention', 'approval.resolve']).optional(), avoidable: z.boolean().optional(),
  approved: z.boolean().optional(),
  by: z.enum(['user', 'policy']).optional(),
}).refine(value => value.avoidable !== undefined || value.approved !== undefined);

export interface PackageClassification { label: OutcomeLabel; reasons: string[] }

/** Conservative runtime validation; missing/corrupt evidence is never a success. */
export async function diagnosePackage(directory: string): Promise<PackageClassification> {
  try {
    const [task, verifications, entropy, outcome, interventions] = await Promise.all([
      readJson(directory, 'task.json').then(value => taskSchema.parse(value)),
      readJsonl(directory, 'verification.jsonl').then(value => z.array(verificationSchema).parse(value)),
      readJson(directory, 'entropy.json').then(value => entropySchema.parse(value)),
      readJson(directory, 'outcome.json').then(value => outcomeSchema.parse(value)),
      readJsonl(directory, 'intervention.jsonl').then(value => z.array(interventionSchema).parse(value)),
    ]);
    const result = (label: OutcomeLabel, reason: string): PackageClassification => ({ label, reasons: [reason] });
    if (outcome.label === 'unsafe_invalid' || entropy.findings.some(finding => ['weakened-tests', 'checks-bypassed', 'unsafe-invalid'].includes(finding.category))) return result('unsafe_invalid', 'unsafe evidence');
    if (outcome.ok === false || outcome.label === 'failed') return result('failed', 'terminal failure');
    if (new Set(task.requirements.map(req => req.id)).size !== task.requirements.length) return result('failed', 'duplicate requirement ids');
    const latest = new Map<string, boolean>();
    const deterministicFailures = new Set<string>();
    const final = verifications.filter(event => event.kind !== 'reproduction');
    for (const event of final) for (const id of event.requirementIds) {
      latest.set(id, event.ok);
      if (event.kind === 'deterministic') {
        if (event.ok) deterministicFailures.delete(id);
        else deterministicFailures.add(id);
      }
    }
    if (deterministicFailures.size || [...latest.values()].includes(false) || final.some(event => !event.requirementIds.length && !event.ok)) return result('failed', 'unresolved verification failure');
    const verified = task.requirements.length > 0 && task.requirements.every(req => latest.get(req.id) === true);
    if (!verified) return result('unverified_success', 'terminal success without complete requirement coverage');
    const assisted = interventions.some(event => event.type !== 'approval.resolve' || event.by !== 'policy');
    return result(assisted ? 'assisted_verified_success' : 'autonomous_verified_success', 'terminal success with requirement coverage');
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError || (error as NodeJS.ErrnoException).code === 'ENOENT') return { label: 'failed', reasons: ['incomplete or malformed package evidence'] };
    throw error;
  }
}

/** Package success policy, also used by CLI metrics. */
export async function classifyPackage(directory: string): Promise<OutcomeLabel> {
  return (await diagnosePackage(directory)).label;
}

async function readJson(directory: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, name), 'utf8'));
}
async function readJsonl(directory: string, name: string): Promise<unknown[]> {
  return (await readFile(join(directory, name), 'utf8')).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as unknown);
}
