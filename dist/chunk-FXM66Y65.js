import {
  LINT_KINDS
} from "./chunk-V64EGJFJ.js";
import {
  atomicWrite
} from "./chunk-YBSX67PD.js";

// src/reflect/dream-plan.ts
import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
var DREAM_KINDS = ["new-lesson", "promote-lesson", "supersede", "merge-duplicates", "archive", "fix-link", "add-as-of"];
var id = z.string().min(1);
var CANONICAL_KINDS = ["identity", "standard", "lexicon", "domain", "person", "preference"];
var DreamChangeSchema = z.discriminatedUnion("op", [
  /** A new candidate lesson (band inferred, source edu:dream). */
  z.object({ op: z.literal("write-lesson"), title: z.string().min(1), body: z.string().min(1), links: z.array(id), tags: z.array(z.string()) }).strict(),
  /** A lifecycle transition, checked against `from` when applied. */
  z.object({ op: z.literal("set-status"), id, from: z.string().min(1), to: z.string().min(1), superseded_by: id.optional() }).strict(),
  /** A new decision superseding an active one (decisions are immutable: they change by replacement). */
  z.object({ op: z.literal("write-decision"), title: z.string().min(1), body: z.string().min(1), supersedes: id, links: z.array(id) }).strict(),
  /** A canonical proposal; it still waits for `edu brain approve`. */
  z.object({ op: z.literal("propose-canonical"), kind: z.enum(CANONICAL_KINDS), title: z.string().min(1), body: z.string().min(1), supersedes: id, links: z.array(id) }).strict(),
  /** Another name for an existing note, so a broken [[link]] resolves. */
  z.object({ op: z.literal("add-alias"), id, alias: z.string().min(1) }).strict()
]);
var DreamProposalSchema = z.object({
  id: z.string().regex(/^P-[a-f0-9]{8}$/),
  kind: z.enum(DREAM_KINDS),
  title: z.string().min(1),
  /** How many independent sessions (or notes) support it. */
  prevalence: z.number().int().nonnegative(),
  /** Session and note ids the proposal rests on; every one existed in the supplied evidence. */
  evidence: z.array(id).min(1),
  rationale: z.string().min(1),
  changes: z.array(DreamChangeSchema).min(1),
  origin: z.enum(["heuristic", "model"]),
  /** The checkbox: applied only when true. Claims a script cannot verify start unchecked. */
  checked: z.boolean(),
  applied: z.string().optional()
}).strict();
var FindingSchema = z.object({ kind: z.enum(LINT_KINDS), severity: z.enum(["error", "warning", "info"]), ids: z.array(z.string()), message: z.string(), fix: z.string(), target: z.string().optional(), evidence: z.array(z.string()).optional() }).strict();
var DreamPlanSchema = z.object({
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
  findings: z.array(FindingSchema)
}).strict();
var dreamPlanPath = (primary) => join(primary.root, "state", "dream-plan.md");
var BLOCK_START = "<!-- edu:dream-plan \u2014 the JSON below is what --apply runs; review with the checkboxes above. -->";
var describeChange = (change) => {
  switch (change.op) {
    case "write-lesson":
      return `write candidate lesson "${change.title}" (inferred, edu:dream)`;
    case "set-status":
      return `${change.id}: ${change.from} \u2192 ${change.to}${change.superseded_by ? ` (superseded by ${change.superseded_by})` : ""}`;
    case "write-decision":
      return `new decision "${change.title}" superseding ${change.supersedes}`;
    case "propose-canonical":
      return `propose canonical ${change.kind} "${change.title}" superseding ${change.supersedes} (waits for edu brain approve)`;
    case "add-alias":
      return `${change.id}: add alias "${change.alias}"`;
  }
};
var oneLine = (text) => text.replace(/\s+/g, " ").trim();
function renderDreamPlan(plan) {
  const hosts = Object.entries(plan.hosts).sort(([a], [b]) => a.localeCompare(b)).map(([host, count]) => `${host} ${count}`).join(", ");
  const lines = [
    "# Edu dream plan",
    "",
    `- Generated: ${plan.generated}`,
    `- Brain: ${plan.brain}`,
    `- Window: last ${plan.days} days \xB7 ${plan.sessions} closed session(s)${hosts ? ` (${hosts})` : ""}`,
    `- Model: ${plan.model ? `${plan.model.cli} \xB7 ${plan.model.promptTokens} prompt tokens \xB7 ${plan.model.proposed} proposed \xB7 ${plan.model.dropped.length} dropped \xB7 ${plan.model.deferred} session(s) not sent` : "none (deterministic)"}`,
    "",
    "Tick `[x]` what to apply and leave `[ ]` what to skip, then run `edu dream --apply`.",
    "Nothing is deleted: archiving sets a lifecycle status (retired, no-evidence); canonical changes stay proposals until `edu brain approve`.",
    "",
    "## Proposals",
    ""
  ];
  if (!plan.proposals.length) lines.push("Nothing to propose.", "");
  for (const p of plan.proposals) {
    lines.push(`- [${p.checked ? "x" : " "}] ${p.id} \xB7 ${p.kind} \xB7 ${oneLine(p.title)}${p.applied ? ` (applied ${p.applied})` : ""}`);
    lines.push(`  - Prevalence: ${p.prevalence} \xB7 Evidence: ${p.evidence.join(", ")} \xB7 Origin: ${p.origin}`);
    lines.push(`  - Why: ${oneLine(p.rationale)}`);
    for (const change of p.changes) lines.push(`  - Change: ${oneLine(describeChange(change))}`);
  }
  lines.push("", "## Lint findings (report only)", "");
  if (!plan.findings.length) lines.push("No findings.");
  else {
    lines.push("| Severity | Kind | Notes | Finding |", "|---|---|---|---|");
    for (const f of plan.findings) lines.push(`| ${f.severity} | ${f.kind} | ${f.ids.join(", ")} | ${oneLine(f.message).replace(/\|/g, "\\|")} |`);
  }
  lines.push("", BLOCK_START, "```json", JSON.stringify(plan, null, 2), "```", "");
  return lines.join("\n");
}
function parseDreamPlan(markdown, path = "dream plan") {
  const start = markdown.lastIndexOf(BLOCK_START);
  const block = start < 0 ? void 0 : /```json\s*\n([\s\S]*?)\n```/.exec(markdown.slice(start))?.[1];
  if (!block) throw new Error(`Unreadable dream plan (no JSON block): ${path}`);
  let raw;
  try {
    raw = JSON.parse(block);
  } catch (error) {
    throw new Error(`Unreadable dream plan JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = DreamPlanSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid dream plan ${path}: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim());
  const boxes = /* @__PURE__ */ new Map();
  for (const match of markdown.slice(0, start).matchAll(/^- \[([ xX])\] (P-[a-f0-9]{8})\b/gm)) boxes.set(match[2], match[1] !== " ");
  return { ...parsed.data, proposals: parsed.data.proposals.map((p) => ({ ...p, checked: boxes.get(p.id) ?? false })) };
}
async function saveDreamPlan(primary, plan) {
  const path = dreamPlanPath(primary);
  await atomicWrite(path, renderDreamPlan(plan));
  return path;
}
async function loadDreamPlan(primary) {
  const path = dreamPlanPath(primary);
  const raw = await readFile(path, "utf8").catch(() => void 0);
  return raw === void 0 ? void 0 : parseDreamPlan(raw, path);
}

export {
  DREAM_KINDS,
  DreamChangeSchema,
  DreamProposalSchema,
  DreamPlanSchema,
  dreamPlanPath,
  renderDreamPlan,
  parseDreamPlan,
  saveDreamPlan,
  loadDreamPlan
};
//# sourceMappingURL=chunk-FXM66Y65.js.map