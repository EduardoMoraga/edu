import { z } from 'zod';
import { CheckSchema } from '../evidence/registry.js';
import type { HarnessLevel } from '../evidence/contracts.js';

const RequirementSchema = z.object({ id: z.string().min(1), text: z.string().min(1) }).strict();
export const PlanSchema = z.object({
  requirements: z.array(RequirementSchema).default([]),
  checks: z.array(CheckSchema).default([]),
  steps: z.array(z.object({
  id: z.string().min(1), role: z.string().min(1), task: z.string().min(1),
  dependsOn: z.array(z.string()), parallelSafe: z.boolean(),
}).strict()),
}).strict().superRefine((plan, context) => {
  const ids = new Set(plan.requirements.map((requirement) => requirement.id));
  for (const check of plan.checks) for (const requirementId of check.requirementIds) {
    if (!ids.has(requirementId)) context.addIssue({ code: 'custom', path: ['checks'], message: `Check '${check.id}' references unknown requirement '${requirementId}'.` });
  }
});
export type Plan = z.infer<typeof PlanSchema>;

export interface PlanningPromptOptions {
  harnessLevel?: HarnessLevel;
  registryInfo?: string;
  taskState?: string;
}

export const planningPrompt = (goal: string, context: string, options: PlanningPromptOptions = {}) => [
  'Create a safe, concise execution plan for the user goal. Return only JSON matching {"requirements":[{"id":"...","text":"..."}],"checks":[{"id":"...","requirementIds":["..."],"command":"...","expect":{"exitCode":0,"stdoutIncludes":"..."},"timeoutMs":30000}],"steps":[{"id":"...","role":"explorer|builder|reviewer","task":"...","dependsOn":[],"parallelSafe":false}]}. requirements must express observable success conditions; checks must be deterministic and bind to requirement ids. Select checks only from the supplied registry; never invent commands.',
  'Use unique step ids; dependencies must reference earlier steps. Mark parallelSafe only for independent read-only work. Use builder for changes.',
  ...(options.harnessLevel === 'H3' ? ['Builder steps must follow reproduce → attribute → fix → verify → report; if verification disproves attribution, return to attribution before one bounded fix. Edu will run deterministic checks.'] : []),
  ...(options.registryInfo ? [`Available tool and deterministic-check registry:\n${options.registryInfo}`] : []),
  ...(options.taskState ? [`Current task state:\n${options.taskState}`] : []),
  `Goal:\n${goal}\n\nContext:\n${context}`,
].join('\n\n');

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try { return JSON.parse(candidate); }
  catch (error) { throw new Error(`Plan response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

export function extractPlan(text: string): Plan {
  const plan = PlanSchema.parse(extractJson(text));
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (ids.has(step.id)) throw new Error(`Plan contains duplicate step id '${step.id}'`);
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Step '${step.id}' depends on missing or later step '${dependency}'`);
    }
    ids.add(step.id);
  }
  return plan;
}

export function repairPrompt(prior: string, error: string): string {
  return `Your previous response was rejected: ${error}\nReturn a corrected plan as JSON only.\n\nPrevious response:\n${prior}`;
}
