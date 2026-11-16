import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ApprovalPolicy, Autonomy, CliId, EduConfig, RoleSpec } from '../core/contracts.js';
import { atomicWrite } from '../brain/store.js';

const CliSchema = z.enum(['claude', 'codex', 'pi', 'opencode', 'agy']);
const RoleSchema = z.object({ id: z.string().min(1), title: z.string().min(1), icon: z.string().min(1), mission: z.string(), autonomy: z.enum(['readonly', 'ask', 'auto', 'full']), cli: CliSchema.optional(), model: z.string().optional() });
const AutonomySchema = z.enum(['readonly', 'ask', 'auto', 'full']);
const CrewSettingsSchema = z.object({
  maxAutonomy: AutonomySchema.optional(),
  env: z.object({ passthrough: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_()]*$/)).optional() }).strict().optional(),
  timeoutMinutes: z.number().int().min(1).max(1440).optional(),
}).strict();

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
  crew: CrewSettingsSchema.optional(),
});

/**
 * The safety policy a person sets in the global config: the autonomy ceiling, the extra variables agents may see,
 * and the approval policy, which is the floor for detached runs (a project config cannot loosen it there).
 */
export interface CrewPolicy { maxAutonomy: Autonomy; passthrough: string[]; approvals: ApprovalPolicy }
const AUTONOMY_RANK: Record<Autonomy, number> = { readonly: 0, ask: 1, auto: 2, full: 3 };
const APPROVAL_RANK: Record<ApprovalPolicy, number> = { auto: 0, 'ask-on-write': 1, 'always-ask': 2 };
const ApprovalsSchema = z.enum(['always-ask', 'ask-on-write', 'auto']);
export const DEFAULT_CREW_POLICY: Readonly<CrewPolicy> = Object.freeze({ maxAutonomy: 'auto', passthrough: [], approvals: 'ask-on-write' });

/** Whether `requested` stays within `ceiling` (readonly < ask < auto < full). */
export function withinAutonomy(requested: Autonomy, ceiling: Autonomy): boolean {
  return AUTONOMY_RANK[requested] <= AUTONOMY_RANK[ceiling];
}

/** The stricter of two approval policies (auto < ask-on-write < always-ask). */
export function stricterApprovals(a: ApprovalPolicy, b: ApprovalPolicy): ApprovalPolicy {
  return APPROVAL_RANK[a] >= APPROVAL_RANK[b] ? a : b;
}

/**
 * The environment variable that carries the parent's resolved `CrewPolicy` to a detached crew worker. The worker
 * never reads the policy from a file: its brain may sit in a workspace an agent or a cloned repository can write,
 * while nothing it starts can change its parent's environment.
 */
export const CREW_POLICY_ENV = 'EDU_CREW_POLICY';

/** A detached worker's policy: the policy its parent resolved, plus the digest of the job it was started for. */
export interface WorkerPolicy extends CrewPolicy { job?: string }

export function encodeWorkerPolicy(policy: WorkerPolicy): string {
  return JSON.stringify({ maxAutonomy: policy.maxAutonomy, passthrough: policy.passthrough, approvals: policy.approvals, ...(policy.job ? { job: policy.job } : {}) });
}

/** The policy in `EDU_CREW_POLICY`; missing or invalid fails closed to the defaults, with no job digest. */
export function decodeWorkerPolicy(text: string | undefined): WorkerPolicy {
  const schema = z.object({ maxAutonomy: AutonomySchema, passthrough: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_()]*$/)), approvals: ApprovalsSchema, job: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
  let raw: unknown;
  try { raw = JSON.parse(text ?? ''); } catch { return { ...DEFAULT_CREW_POLICY, passthrough: [] }; }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_CREW_POLICY, passthrough: [] };
}

/** Lowers every role above `ceiling` to it. Returns the config (unchanged when nothing was lowered) and the lowered roles. */
export function capRoleAutonomy(config: EduConfig, ceiling: Autonomy): { config: EduConfig; lowered: Array<{ id: string; requested: Autonomy }> } {
  const lowered = config.roles.filter(role => !withinAutonomy(role.autonomy, ceiling)).map(role => ({ id: role.id, requested: role.autonomy }));
  if (!lowered.length) return { config, lowered };
  return { config: { ...config, roles: config.roles.map(role => withinAutonomy(role.autonomy, ceiling) ? role : { ...role, autonomy: ceiling }) }, lowered };
}

/**
 * Crew safety settings from the global config (`<eduHome>/config.json`) only. A project config lives inside
 * the workspace, where agents and cloned repositories can write, so it can never raise them. A missing file
 * means the defaults; an unreadable or invalid `crew` section (or `approvals` value) fails closed to the defaults.
 */
export async function loadCrewPolicy(eduHome: string): Promise<CrewPolicy> {
  const defaults: CrewPolicy = { ...DEFAULT_CREW_POLICY, passthrough: [] };
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(eduHome, 'config.json'), 'utf8')); }
  catch { return defaults; }
  const config = raw && typeof raw === 'object' ? raw as { crew?: unknown; approvals?: unknown } : {};
  const approvals = ApprovalsSchema.safeParse(config.approvals ?? defaults.approvals);
  const parsed = CrewSettingsSchema.safeParse(config.crew ?? {});
  if (!parsed.success) return { ...defaults, approvals: approvals.success ? approvals.data : defaults.approvals };
  return { maxAutonomy: parsed.data.maxAutonomy ?? defaults.maxAutonomy, passthrough: parsed.data.env?.passthrough ?? [], approvals: approvals.success ? approvals.data : defaults.approvals };
}

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
