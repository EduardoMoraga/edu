import { join } from 'node:path';
import { atomicWrite, slugify } from '../brain/store.js';
import type { CliId, EduConfig, HarnessLevel } from '../core/contracts.js';
import { assignCli } from './assign.js';
import type { Plan } from './plan.js';

export interface SpecDocument { path: string; markdown: string }

/** Materializes the exact plan/check commands that the approval callback sees. */
export async function writeSpec(root: string, goal: string, playbookName: string, harness: HarnessLevel, plan: Plan, config: EduConfig, available: CliId[], now: Date, runId: string): Promise<SpecDocument> {
  const stamp = `${now.toISOString().slice(0, 10).replaceAll('-', '')}-${now.toISOString().slice(11, 16).replace(':', '')}`;
  const path = join(root, 'specs', `${stamp}-${slugify(goal) || 'run'}-${runId.slice(0, 8)}.md`);
  const lines = [
    `# ${goal}`, '', `Playbook: ${playbookName}`, `Harness: ${harness}`, '',
    '## Requirements', '',
    ...plan.requirements.map(requirement => `- **${requirement.id}** ${requirement.text}`),
    ...(plan.requirements.length ? [] : ['- None specified.']), '',
    '## Deterministic checks', '',
    ...plan.checks.flatMap(check => [
      `### ${check.id}`, '',
      `Requirements: ${check.requirementIds.join(', ')}`, `Timeout: ${check.timeoutMs} ms`,
      `Expected exit code: ${check.expect.exitCode ?? 0}`,
      ...(check.expect.stdoutIncludes === undefined ? [] : [`Expected stdout includes: ${JSON.stringify(check.expect.stdoutIncludes)}`]),
      '', '```sh', check.command, '```', '',
    ]),
    ...(plan.checks.length ? [] : ['- No deterministic checks specified.', '']),
    '## Steps', '',
    ...plan.steps.map(step => `- **${step.id}** — ${step.role} (${assignCli(step.role, config, available)}): ${step.task}${step.dependsOn.length ? `; after ${step.dependsOn.join(', ')}` : ''}`),
    ...(plan.steps.length ? [] : ['- No execution steps specified.']), '',
  ];
  const markdown = `${lines.join('\n')}\n`;
  await atomicWrite(path, markdown);
  return { path, markdown };
}
