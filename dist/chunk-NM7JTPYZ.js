import {
  atomicWrite
} from "./chunk-2AE6KVNY.js";

// src/orchestrator/config.ts
import { readFile } from "fs/promises";
import { z } from "zod";
var CliSchema = z.enum(["claude", "codex", "pi", "opencode", "agy"]);
var RoleSchema = z.object({ id: z.string().min(1), title: z.string().min(1), icon: z.string().min(1), mission: z.string(), autonomy: z.enum(["readonly", "ask", "auto", "full"]), cli: CliSchema.optional(), model: z.string().optional() });
var EduConfigSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["solo", "crew"]),
  defaultCli: CliSchema,
  playbook: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i).default("default"),
  roles: z.array(RoleSchema).min(1),
  approvals: z.enum(["always-ask", "ask-on-write", "auto"]),
  context: z.object({ budgetTokens: z.number().int().positive() }),
  brain: z.object({ obsidianVault: z.string().optional() }),
  lang: z.enum(["en", "es"])
});
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
  defaultConfig,
  loadConfig,
  saveConfig
};
//# sourceMappingURL=chunk-NM7JTPYZ.js.map