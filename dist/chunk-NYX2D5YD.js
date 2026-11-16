import {
  atomicWrite
} from "./chunk-YINGR2DA.js";

// src/workspace/config.ts
import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
var CliSchema = z.enum(["claude", "codex", "pi", "opencode", "agy"]);
var RoleSchema = z.object({ id: z.string().min(1), title: z.string().min(1), icon: z.string().min(1), mission: z.string(), autonomy: z.enum(["readonly", "ask", "auto", "full"]), cli: CliSchema.optional(), model: z.string().optional() });
var AutonomySchema = z.enum(["readonly", "ask", "auto", "full"]);
var CrewSettingsSchema = z.object({
  maxAutonomy: AutonomySchema.optional(),
  env: z.object({ passthrough: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_()]*$/)).optional() }).strict().optional(),
  timeoutMinutes: z.number().int().min(1).max(1440).optional()
}).strict();
var EduConfigSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["solo", "crew"]),
  defaultCli: CliSchema,
  playbook: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i).default("default"),
  roles: z.array(RoleSchema).min(1),
  approvals: z.enum(["always-ask", "ask-on-write", "auto"]),
  context: z.object({ budgetTokens: z.number().int().positive() }),
  routing: z.object({
    executor: z.object({ cli: CliSchema, model: z.string().min(1).optional() }).optional(),
    advisor: z.object({ cli: CliSchema, model: z.string().min(1).optional() }).optional(),
    reviewer: z.object({ cli: CliSchema, model: z.string().min(1).optional() }).optional()
  }).strict().optional(),
  execution: z.object({
    maxSpawns: z.number().int().min(1).max(256).default(32),
    maxConcurrency: z.number().int().min(1).max(8).default(3),
    timeoutMs: z.number().int().min(1e3).max(864e5).default(18e5),
    maxAdvisorCalls: z.number().int().min(0).max(1).default(0)
  }).strict().optional(),
  brain: z.object({ obsidianVault: z.string().optional() }),
  lang: z.enum(["en", "es"]),
  brainDir: z.string().min(1).optional(),
  sourcesDir: z.string().min(1).optional(),
  identity: z.object({ name: z.string().min(1), role: z.string().optional(), tone: z.string().optional(), summary: z.string().optional() }).optional(),
  crew: CrewSettingsSchema.optional()
});
var AUTONOMY_RANK = { readonly: 0, ask: 1, auto: 2, full: 3 };
var APPROVAL_RANK = { auto: 0, "ask-on-write": 1, "always-ask": 2 };
var ApprovalsSchema = z.enum(["always-ask", "ask-on-write", "auto"]);
var DEFAULT_CREW_POLICY = Object.freeze({ maxAutonomy: "auto", passthrough: [], approvals: "ask-on-write" });
function withinAutonomy(requested, ceiling) {
  return AUTONOMY_RANK[requested] <= AUTONOMY_RANK[ceiling];
}
function stricterApprovals(a, b) {
  return APPROVAL_RANK[a] >= APPROVAL_RANK[b] ? a : b;
}
var CREW_POLICY_ENV = "EDU_CREW_POLICY";
function encodeWorkerPolicy(policy) {
  return JSON.stringify({ maxAutonomy: policy.maxAutonomy, passthrough: policy.passthrough, approvals: policy.approvals, ...policy.job ? { job: policy.job } : {} });
}
function decodeWorkerPolicy(text) {
  const schema = z.object({ maxAutonomy: AutonomySchema, passthrough: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_()]*$/)), approvals: ApprovalsSchema, job: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
  let raw;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    return { ...DEFAULT_CREW_POLICY, passthrough: [] };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_CREW_POLICY, passthrough: [] };
}
function capRoleAutonomy(config, ceiling) {
  const lowered = config.roles.filter((role) => !withinAutonomy(role.autonomy, ceiling)).map((role) => ({ id: role.id, requested: role.autonomy }));
  if (!lowered.length) return { config, lowered };
  return { config: { ...config, roles: config.roles.map((role) => withinAutonomy(role.autonomy, ceiling) ? role : { ...role, autonomy: ceiling }) }, lowered };
}
async function loadCrewPolicy(eduHome) {
  const defaults = { ...DEFAULT_CREW_POLICY, passthrough: [] };
  let raw;
  try {
    raw = JSON.parse(await readFile(join(eduHome, "config.json"), "utf8"));
  } catch {
    return defaults;
  }
  const config = raw && typeof raw === "object" ? raw : {};
  const approvals = ApprovalsSchema.safeParse(config.approvals ?? defaults.approvals);
  const parsed = CrewSettingsSchema.safeParse(config.crew ?? {});
  if (!parsed.success) return { ...defaults, approvals: approvals.success ? approvals.data : defaults.approvals };
  return { maxAutonomy: parsed.data.maxAutonomy ?? defaults.maxAutonomy, passthrough: parsed.data.env?.passthrough ?? [], approvals: approvals.success ? approvals.data : defaults.approvals };
}
function defaultConfig(defaultCli) {
  const roles = [
    { id: "lead", title: "Lead", icon: "\u25C6", mission: "Understand the goal, plan bounded work, and coordinate execution.", autonomy: "readonly" },
    { id: "explorer", title: "Explorer", icon: "\u{1F50D}", mission: "Investigate the code and report evidence without changing files.", autonomy: "readonly" },
    { id: "builder", title: "Builder", icon: "\u2699", mission: "Implement the assigned change and verify it.", autonomy: "auto" },
    { id: "reviewer", title: "Reviewer", icon: "\u2696", mission: "Review the result and return a strict pass/fix verdict.", autonomy: "readonly" }
  ];
  return { version: 1, mode: "solo", defaultCli, playbook: "default", roles, approvals: "ask-on-write", context: { budgetTokens: 8e3 }, brain: {}, lang: "en" };
}
async function loadConfig(path) {
  let raw;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to load config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return EduConfigSchema.parse(raw);
}
async function saveConfig(path, config) {
  const validated = EduConfigSchema.parse(config);
  await atomicWrite(path, `${JSON.stringify(validated, null, 2)}
`);
}

export {
  EduConfigSchema,
  DEFAULT_CREW_POLICY,
  withinAutonomy,
  stricterApprovals,
  CREW_POLICY_ENV,
  encodeWorkerPolicy,
  decodeWorkerPolicy,
  capRoleAutonomy,
  loadCrewPolicy,
  defaultConfig,
  loadConfig,
  saveConfig
};
//# sourceMappingURL=chunk-NYX2D5YD.js.map