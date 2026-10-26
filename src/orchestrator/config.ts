import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { CliId, EduConfig, RoleSpec } from '../core/contracts.js';
import { atomicWrite } from '../brain/store.js';

const CliSchema = z.enum(['claude', 'codex', 'pi', 'opencode', 'agy']);
const RoleSchema = z.object({ id: z.string().min(1), title: z.string().min(1), icon: z.string().min(1), mission: z.string(), autonomy: z.enum(['readonly', 'ask', 'auto', 'full']), cli: CliSchema.optional(), model: z.string().optional() });
export const EduConfigSchema = z.object({
  version: z.literal(1), mode: z.enum(['solo', 'crew']), defaultCli: CliSchema,
  playbook: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i).default('default'),
  roles: z.array(RoleSchema).min(1), approvals: z.enum(['always-ask', 'ask-on-write', 'auto']),
  context: z.object({ budgetTokens: z.number().int().positive() }),
  routing: z.object({
    executor: z.object({ cli: CliSchema, model: z.string().min(1).optional() }).optional(),
    advisor: z.object({ cli: CliSchema, model: z.string().min(1).optional() }).optional(),
    reviewer: z.object({ cli: CliSchema, model: z.string().min(1).optional() }).optional(),
  }).strict().optional(),
  execution: z.object({
    maxSpawns: z.number().int().min(1).max(256).default(32),
    maxConcurrency: z.number().int().min(1).max(8).default(3),
    timeoutMs: z.number().int().min(1000).max(86_400_000).default(1_800_000),
    maxAdvisorCalls: z.number().int().min(0).max(1).default(0),
  }).strict().optional(),
  brain: z.object({ obsidianVault: z.string().optional() }), lang: z.enum(['en', 'es']),
  brainDir: z.string().min(1).optional(), sourcesDir: z.string().min(1).optional(),
  identity: z.object({ name: z.string().min(1), role: z.string().optional(), tone: z.string().optional(), summary: z.string().optional() }).optional(),
});

export function defaultConfig(defaultCli: CliId): EduConfig {
  const roles: RoleSpec[] = [
    { id: 'lead', title: 'Lead', icon: '◆', mission: 'Understand the goal, plan bounded work, and coordinate execution.', autonomy: 'readonly' },
    { id: 'explorer', title: 'Explorer', icon: '🔍', mission: 'Investigate the code and report evidence without changing files.', autonomy: 'readonly' },
    { id: 'builder', title: 'Builder', icon: '⚙', mission: 'Implement the assigned change and verify it.', autonomy: 'auto' },
    { id: 'reviewer', title: 'Reviewer', icon: '⚖', mission: 'Review the result and return a strict pass/fix verdict.', autonomy: 'readonly' },
  ];
  return { version: 1, mode: 'solo', defaultCli, playbook: 'default', roles, approvals: 'ask-on-write', context: { budgetTokens: 8000 }, brain: {}, lang: 'en' };
}

export async function loadConfig(path: string): Promise<EduConfig> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`Unable to load config at ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  return EduConfigSchema.parse(raw);
}

export async function saveConfig(path: string, config: EduConfig): Promise<void> {
  const validated = EduConfigSchema.parse(config);
  await atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`);
}
