import { z } from 'zod';

export const PlanSchema = z.object({ steps: z.array(z.object({
  id: z.string().min(1), role: z.string().min(1), task: z.string().min(1),
  dependsOn: z.array(z.string()), parallelSafe: z.boolean(),
}).strict()) }).strict();
export type Plan = z.infer<typeof PlanSchema>;

export const planningPrompt = (goal: string, context: string) => [
  'Create a safe, concise execution plan for the user goal. Return only JSON matching {"steps":[{"id":"...","role":"explorer|builder|reviewer","task":"...","dependsOn":[],"parallelSafe":false}]}.',
  'Use unique step ids; dependencies must reference earlier steps. Mark parallelSafe only for independent read-only work. Use builder for changes.',
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
