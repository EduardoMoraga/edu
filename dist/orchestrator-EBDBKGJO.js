import {
  CheckSchema,
  diagnosePackage,
  loadChecks,
  loadTools,
  runCheck
} from "./chunk-NX42RSBK.js";
import "./chunk-ZRDQ3XVZ.js";
import {
  truncateToTokens
} from "./chunk-D45JK3LN.js";
import "./chunk-2N4S3BOB.js";
import {
  resolveTemplatesDir
} from "./chunk-QSTE2VXK.js";
import "./chunk-HITNXL4T.js";
import "./chunk-DGIFDAPF.js";
import {
  autoMaintain
} from "./chunk-TUQ7ZDSQ.js";
import "./chunk-I6JWASFE.js";
import {
  measuredEngine
} from "./chunk-5G4RNW33.js";
import "./chunk-6GXTQRCF.js";
import "./chunk-VHSIB24T.js";
import {
  EduConfigSchema,
  defaultConfig,
  loadConfig,
  saveConfig
} from "./chunk-SBJPBEE4.js";
import {
  atomicWrite,
  slugify
} from "./chunk-Z4O66FDA.js";
import "./chunk-YPR7PZSQ.js";

// src/orchestrator/assign.ts
function roleRoute(role, config) {
  const key = role === "builder" ? "executor" : role === "reviewer" ? "reviewer" : role === "advisor" ? "advisor" : void 0;
  return key ? config.routing?.[key] : void 0;
}
function assignCli(role, config, available) {
  const route = roleRoute(role, config);
  if (route) {
    if (!available.includes(route.cli)) throw new Error(`Configured ${role} CLI '${route.cli}' is unavailable; no fallback was disclosed.`);
    return route.cli;
  }
  if (config.mode === "solo") return config.defaultCli;
  const spec = config.roles.find((candidate) => candidate.id === role);
  const configured = spec?.cli;
  if (role === "reviewer") {
    const builderCli = assignCli("builder", config, available);
    if (configured && available.includes(configured) && configured !== builderCli) return configured;
    const diverse = available.find((cli) => cli !== builderCli);
    if (diverse) return diverse;
  }
  return configured && available.includes(configured) ? configured : available[0] ?? config.defaultCli;
}

// src/orchestrator/plan.ts
import { z } from "zod";
var RequirementSchema = z.object({ id: z.string().min(1), text: z.string().min(1) }).strict();
var PlanSchema = z.object({
  requirements: z.array(RequirementSchema).default([]),
  checks: z.array(CheckSchema).default([]),
  steps: z.array(z.object({
    id: z.string().min(1),
    role: z.string().min(1),
    task: z.string().min(1),
    dependsOn: z.array(z.string()),
    parallelSafe: z.boolean()
  }).strict())
}).strict().superRefine((plan, context) => {
  const ids = new Set(plan.requirements.map((requirement) => requirement.id));
  if (ids.size !== plan.requirements.length) context.addIssue({ code: "custom", path: ["requirements"], message: "Requirement IDs must be unique." });
  const checkIds = /* @__PURE__ */ new Set();
  for (const check of plan.checks) {
    if (checkIds.has(check.id)) context.addIssue({ code: "custom", path: ["checks"], message: `Duplicate check ID '${check.id}'.` });
    checkIds.add(check.id);
    if (!check.requirementIds.length) context.addIssue({ code: "custom", path: ["checks"], message: `Check '${check.id}' must reference at least one requirement.` });
  }
  for (const check of plan.checks) for (const requirementId of check.requirementIds) {
    if (!ids.has(requirementId)) context.addIssue({ code: "custom", path: ["checks"], message: `Check '${check.id}' references unknown requirement '${requirementId}'.` });
  }
});
var planningPrompt = (goal, context, options = {}) => [
  'Create a safe, concise execution plan for the user goal. Return only JSON matching {"requirements":[{"id":"R-1","text":"..."}],"checks":[{"id":"...","requirementIds":["R-1"],"command":"...","expect":{"exitCode":0,"stdoutIncludes":"..."},"timeoutMs":30000}],"steps":[{"id":"...","role":"explorer|builder|reviewer","task":"...","dependsOn":[],"parallelSafe":false}]}. Requirements must express observable success conditions with R-ids. Propose deterministic checks bound to requirement ids; prefer supplied registry checks when they fit. Proposed commands become part of the spec and run only after spec approval. Never propose destructive commands.',
  "Use unique step ids; dependencies must reference earlier steps. Mark parallelSafe only for independent read-only work. Use builder for changes.",
  ...options.playbook ? [`Follow this playbook method when planning:
${options.playbook}`] : [],
  ...options.harnessLevel === "H3" ? ["Builder steps must follow reproduce \u2192 attribute \u2192 fix \u2192 verify \u2192 report; if verification disproves attribution, return to attribution before one bounded fix. Edu will run deterministic checks."] : [],
  ...options.registryInfo ? [`Available tool and deterministic-check registry:
${options.registryInfo}`] : [],
  ...options.taskState ? [`Current task state:
${options.taskState}`] : [],
  `Goal:
${goal}

Context:
${context}`
].join("\n\n");
function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Plan response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function extractPlan(text) {
  const plan = PlanSchema.parse(extractJson(text));
  for (const check of plan.checks) {
    if (isDestructiveCheckCommand(check.command)) throw new Error(`Plan check '${check.id}' contains an obviously destructive command: ${check.command}`);
  }
  const ids = /* @__PURE__ */ new Set();
  for (const step of plan.steps) {
    if (ids.has(step.id)) throw new Error(`Plan contains duplicate step id '${step.id}'`);
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Step '${step.id}' depends on missing or later step '${dependency}'`);
    }
    ids.add(step.id);
  }
  return plan;
}
function isDestructiveCheckCommand(command) {
  return /\brm\s+-(?:[A-Za-z]*r[A-Za-z]*f|[A-Za-z]*f[A-Za-z]*r)\b|\bgit\s+push\b|\bcurl\b[^\n|]*\|\s*(?:ba)?sh\b|\bsudo\b|>\s*\/dev\/|\bformat\b/i.test(command);
}
function repairPrompt(prior, error) {
  return `Your previous response was rejected: ${error}
Return a corrected plan as JSON only.

Previous response:
${prior}`;
}

// src/orchestrator/run.ts
import { appendFile, mkdir as mkdir2, open, writeFile } from "fs/promises";
import { dirname, join as join5 } from "path";
import { randomUUID } from "crypto";
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
import { z as z3 } from "zod";

// src/evidence/package.ts
import { mkdir } from "fs/promises";
import { join } from "path";
var types = (events, ...names) => events.filter((event) => names.includes(event.type));
var jsonl = (events) => events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}
` : "";
async function buildEpisodePackage(root, runId, events, options = {}) {
  const directory = join(root, "runs", runId);
  await mkdir(directory, { recursive: true });
  const taskEvent = events.find((event) => event.type === "task.define");
  const runEvent = events.find((event) => event.type === "run.start");
  const outcomeEvent = [...events].reverse().find((event) => event.type === "outcome");
  const task = {
    runId,
    ...runEvent?.type === "run.start" ? { goal: runEvent.goal, mode: runEvent.mode, startedAt: runEvent.at } : {},
    ...taskEvent?.type === "task.define" ? { requirements: taskEvent.requirements, successCriteria: taskEvent.successCriteria ?? [] } : { requirements: [] },
    limitations: options.limitations ?? []
  };
  const outcome = outcomeEvent?.type === "outcome" ? outcomeEvent : events.findLast((event) => event.type === "run.end") ?? { metrics: {} };
  const entropyEvents = types(events, "entropy.finding");
  const entropy = { findings: [...entropyEvents, ...(options.entropyFindings ?? []).map((finding) => ({ type: "entropy.finding", ...finding }))] };
  const content = {
    "task.json": `${JSON.stringify(task, null, 2)}
`,
    "action.jsonl": jsonl(events),
    "tool.jsonl": jsonl(types(events, "tool.call", "tool.result")),
    "context.jsonl": jsonl(types(events, "context.trace", "brain.recall", "brain.learn")),
    "verification.jsonl": jsonl(types(events, "verify.result")),
    "attribution.jsonl": jsonl(types(events, "failure.attribution")),
    "intervention.jsonl": jsonl(types(events, "intervention", "approval.resolve")),
    "entropy.json": `${JSON.stringify(entropy, null, 2)}
`,
    "outcome.json": `${JSON.stringify(outcome, null, 2)}
`,
    "report.md": makeReport(task.requirements, types(events, "verify.result"), task.limitations)
  };
  await Promise.all(Object.entries(content).map(([name, body]) => atomicWrite(join(directory, name), body)));
  return directory;
}
function makeReport(requirements, verification, limitations) {
  const lines = ["# Verification report", "", "| Requirement | Evidence | Status |", "|---|---|---|"];
  for (const requirement of requirements) {
    const evidence = verification.filter((event) => event.type === "verify.result" && event.kind !== "reproduction" && event.requirementIds.includes(requirement.id));
    const latest = evidence.at(-1);
    const deterministic = evidence.filter((event) => event.type === "verify.result" && event.kind === "deterministic").at(-1);
    const status = deterministic?.type === "verify.result" && !deterministic.ok ? "failed" : latest?.type === "verify.result" ? latest.ok ? "verified" : "failed" : "unverified";
    const descriptions = evidence.map((event) => event.type === "verify.result" ? `${event.kind}: ${event.output.replaceAll("|", "\\|").replaceAll("\n", " ")}` : "").join("<br>") || "No evidence recorded";
    lines.push(`| ${requirement.id}: ${requirement.text.replaceAll("|", "\\|")} | ${descriptions} | ${status} |`);
  }
  lines.push("", "## Limitations", "");
  lines.push(...limitations.length ? limitations.map((limitation) => `- ${limitation}`) : ["- None recorded."]);
  return `${lines.join("\n")}
`;
}

// src/evidence/entropy.ts
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { join as join2 } from "path";
var exec = promisify(execFile);
async function auditGitDiff(cwd, startCommit, applicableRequirementIds = []) {
  const [{ stdout: diff }, { stdout: names }, { stdout: untracked }] = await Promise.all([
    exec("git", ["diff", "--no-ext-diff", "--unified=0", startCommit, "--"], { cwd, maxBuffer: 16 * 1024 * 1024 }),
    exec("git", ["diff", "--name-only", startCommit, "--"], { cwd }),
    exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd })
  ]);
  const changed = new Set(names.split(/\r?\n/).filter(Boolean));
  const addedPaths = untracked.split(/\r?\n/).filter(Boolean);
  const findings = [];
  findings.push(...await checkRegistryFindings(cwd, startCommit, new Set(applicableRequirementIds)));
  for (const path of [...changed, ...addedPaths]) {
    if (/(?:^|\/)(?:debug|scratch|tmp)[^/]*\.(?:js|ts|sh|py)$|\.orig$/i.test(path)) {
      findings.push({ category: "residue", severity: 2, path, detail: "Debug, scratch, temporary, or backup file remains in the worktree." });
    }
  }
  const added = diff.match(/^\+(?!\+).*/gm) ?? [];
  const removed = diff.match(/^-(?!-).*/gm) ?? [];
  if (added.some((line) => /\bconsole\.log\s*\(/.test(line))) {
    findings.push({ category: "residue", severity: 1, path: "diff", detail: "Added console.log call detected." });
  }
  if (added.some((line) => /\b(?:it|test|describe)\.(?:skip|only)\s*\(/.test(line))) {
    findings.push({ category: "weakened-tests", severity: 3, path: "diff", detail: "A test suite or case was skipped or focused." });
  }
  const assertionCount = (lines) => lines.filter((line) => /\bexpect\s*\(|\bassert(?:\.|\s)/.test(line)).length;
  const testCount = (lines) => lines.filter((line) => /\b(?:it|test)\s*\(/.test(line)).length;
  const weakenedAssertions = Math.max(0, assertionCount(removed) - assertionCount(added));
  const removedTests = Math.max(0, testCount(removed) - testCount(added));
  if (weakenedAssertions || removedTests) {
    findings.push({ category: "weakened-tests", severity: 3, path: "diff", detail: `${weakenedAssertions} net assertion line(s) and ${removedTests} net test declaration line(s) removed.` });
  }
  if (changed.has("package.json")) {
    findings.push({ category: "dependency-churn", severity: 2, path: "package.json", detail: "package.json changed; confirm dependency changes are required for this run." });
  }
  findings.push(...await staleDocFindings(cwd, changed));
  const severity = findings.reduce((highest, finding) => Math.max(highest, finding.severity), 0);
  return { startCommit, findings, severity };
}
async function checkRegistryFindings(cwd, startCommit, applicableRequirementIds) {
  const path = ".edu/harness/checks.json";
  let baselineText;
  try {
    baselineText = (await exec("git", ["show", `${startCommit}:${path}`], { cwd })).stdout;
  } catch {
    return [];
  }
  const baseline = parseCheckSnapshots(baselineText);
  if (!baseline) return [];
  const applicableBaseline = baseline.filter((check) => check.requirementIds.some((id) => applicableRequirementIds.has(id)));
  if (!applicableBaseline.length) return [];
  let currentText;
  try {
    currentText = await readFile(join2(cwd, path), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") return [];
    return applicableBaseline.map((check) => ({ category: "checks-bypassed", severity: 3, path, detail: `Configured check '${check.id}' was removed after the run-start commit.` }));
  }
  const current = parseCheckSnapshots(currentText);
  if (!current) {
    return [{ category: "checks-bypassed", severity: 3, path, detail: "The configured check registry became invalid after the run-start commit." }];
  }
  const currentById = new Map(current.map((check) => [check.id, check]));
  const findings = [];
  for (const prior of applicableBaseline) {
    const updated = currentById.get(prior.id);
    if (!updated) {
      findings.push({ category: "checks-bypassed", severity: 3, path, detail: `Configured check '${prior.id}' was removed after the run-start commit.` });
      continue;
    }
    const lostRequirements = prior.requirementIds.filter((id) => !updated.requirementIds.includes(id));
    const lostOutputExpectation = Boolean(prior.expect.stdoutIncludes?.trim()) && !updated.expect.stdoutIncludes?.trim();
    const lostNonzeroExitExpectation = prior.expect.exitCode !== void 0 && prior.expect.exitCode !== 0 && (updated.expect.exitCode === void 0 || updated.expect.exitCode === 0);
    if (lostRequirements.length || lostOutputExpectation || lostNonzeroExitExpectation) {
      const reasons = [
        lostRequirements.length ? `removed requirement bindings ${lostRequirements.join(", ")}` : "",
        lostOutputExpectation ? "removed stdout expectation" : "",
        lostNonzeroExitExpectation ? "relaxed the expected exit code to success" : ""
      ].filter(Boolean);
      findings.push({ category: "checks-bypassed", severity: 3, path, detail: `Configured check '${prior.id}' was relaxed: ${reasons.join("; ")}.` });
    }
  }
  return findings;
}
function parseCheckSnapshots(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return void 0;
    const snapshots = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !Array.isArray(item.requirementIds) || !item.requirementIds.every((id) => typeof id === "string") || !item.expect || typeof item.expect !== "object") return void 0;
      const { exitCode, stdoutIncludes } = item.expect;
      if (exitCode !== void 0 && typeof exitCode !== "number" || stdoutIncludes !== void 0 && typeof stdoutIncludes !== "string") return void 0;
      snapshots.push({ id: item.id, requirementIds: item.requirementIds, expect: { ...exitCode !== void 0 ? { exitCode } : {}, ...stdoutIncludes !== void 0 ? { stdoutIncludes } : {} } });
    }
    return snapshots;
  } catch {
    return void 0;
  }
}
async function staleDocFindings(cwd, changed) {
  const sourceFiles = [...changed].filter((path) => /\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(path));
  const changedDocs = new Set([...changed].filter((path) => /\.(?:md|mdx|rst)$/.test(path)));
  const docs = await exec("git", ["ls-files", "*.md", "*.mdx", "*.rst"], { cwd }).then((result) => result.stdout.split(/\r?\n/).filter(Boolean));
  const findings = [];
  for (const source of sourceFiles) {
    const moduleName = source.split("/").pop()?.replace(/\.[^.]+$/, "");
    if (!moduleName) continue;
    for (const doc of docs) {
      if (changedDocs.has(doc)) continue;
      try {
        if ((await readFile(join2(cwd, doc), "utf8")).includes(moduleName)) {
          findings.push({ category: "stale-docs", severity: 1, path: doc, detail: `Documentation mentions changed module "${moduleName}" but was not updated.` });
          break;
        }
      } catch {
      }
    }
  }
  return findings;
}

// src/orchestrator/playbook.ts
import { readFile as readFile2 } from "fs/promises";
import { homedir } from "os";
import { join as join3 } from "path";
import { parse } from "yaml";
import { z as z2 } from "zod";
var RoleOverrideSchema = z2.object({
  title: z2.string().optional(),
  icon: z2.string().optional(),
  mission: z2.string().optional(),
  autonomy: z2.enum(["readonly", "ask", "auto", "full"]).optional(),
  cli: z2.enum(["claude", "codex", "pi", "opencode", "agy"]).optional(),
  model: z2.string().optional()
}).strict();
var FrontmatterSchema = z2.object({
  name: z2.string().min(1),
  description: z2.string().min(1),
  roles: z2.record(z2.string(), RoleOverrideSchema).optional(),
  harness: z2.enum(["H0", "H1", "H2", "H3"]).default("H3"),
  requireSpecApproval: z2.boolean().default(true),
  maxFixRounds: z2.number().int().min(0).max(5).default(1)
}).strict();
async function loadPlaybook(name, projectRoot, locations = {}) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`Invalid playbook name '${name}'.`);
  const paths = [
    join3(projectRoot, "playbooks", `${name}.md`),
    join3(locations.globalRoot ?? join3(homedir(), ".edu"), "playbooks", `${name}.md`),
    join3(locations.templatesDir ?? resolveTemplatesDir(), "playbooks", "default.md")
  ];
  for (const path of paths) {
    let markdown;
    try {
      markdown = await readFile2(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
    if (!match) throw new Error(`Playbook '${path}' must begin with YAML frontmatter.`);
    const meta = FrontmatterSchema.parse(parse(match[1]));
    if (path !== paths[2] && meta.name !== name) throw new Error(`Playbook '${path}' declares name '${meta.name}', expected '${name}'.`);
    return { ...meta, body: match[2].trim(), path };
  }
  if (name !== "default") throw new Error(`Playbook '${name}' not found in project, global, or bundled templates.`);
  return { name: "default", description: "Built-in orchestration method", harness: "H3", requireSpecApproval: true, maxFixRounds: 1, body: "Plan observable requirements and deterministic checks. Approve the spec, build, verify, then review.", path: "builtin:default" };
}
function applyPlaybookRoles(config, playbook) {
  if (!playbook.roles) return config;
  const known = new Set(config.roles.map((role) => role.id));
  for (const id of Object.keys(playbook.roles)) if (!known.has(id)) throw new Error(`Playbook role override '${id}' is not configured.`);
  return { ...config, roles: config.roles.map((role) => ({ ...role, ...playbook.roles?.[role.id] })) };
}
function workerMethod(playbook) {
  return truncateToTokens(`Playbook: ${playbook.name}
${playbook.description}

${playbook.body}`, 400);
}

// src/orchestrator/spec.ts
import { join as join4 } from "path";
async function writeSpec(root, goal, playbookName, harness, plan, config, available, now, runId) {
  const stamp = `${now.toISOString().slice(0, 10).replaceAll("-", "")}-${now.toISOString().slice(11, 16).replace(":", "")}`;
  const path = join4(root, "specs", `${stamp}-${slugify(goal) || "run"}-${runId.slice(0, 8)}.md`);
  const lines = [
    `# ${goal}`,
    "",
    `Playbook: ${playbookName}`,
    `Harness: ${harness}`,
    "",
    "## Requirements",
    "",
    ...plan.requirements.map((requirement) => `- **${requirement.id}** ${requirement.text}`),
    ...plan.requirements.length ? [] : ["- None specified."],
    "",
    "## Deterministic checks",
    "",
    ...plan.checks.flatMap((check) => [
      `### ${check.id}`,
      "",
      `Requirements: ${check.requirementIds.join(", ")}`,
      `Timeout: ${check.timeoutMs} ms`,
      `Expected exit code: ${check.expect.exitCode ?? 0}`,
      ...check.expect.stdoutIncludes === void 0 ? [] : [`Expected stdout includes: ${JSON.stringify(check.expect.stdoutIncludes)}`],
      "",
      "```sh",
      check.command,
      "```",
      ""
    ]),
    ...plan.checks.length ? [] : ["- No deterministic checks specified.", ""],
    "## Steps",
    "",
    ...plan.steps.map((step) => `- **${step.id}** \u2014 ${step.role} (${assignCli(step.role, config, available)}): ${step.task}${step.dependsOn.length ? `; after ${step.dependsOn.join(", ")}` : ""}`),
    ...plan.steps.length ? [] : ["- No execution steps specified."],
    ""
  ];
  const markdown = `${lines.join("\n")}
`;
  await atomicWrite(path, markdown);
  return { path, markdown };
}

// src/orchestrator/budget.ts
var BudgetExhausted = class extends Error {
};
var RunBudget = class {
  limits;
  spawns = 0;
  advisorCalls = 0;
  active = 0;
  waiters = [];
  async acquire(signal) {
    while (this.active >= this.limits.maxConcurrency) {
      await new Promise((resolve, reject) => {
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(new Error("Run cancelled while waiting for execution slot."));
        };
        const cleanup = () => {
          this.waiters = this.waiters.filter((item) => item !== wake);
          signal?.removeEventListener("abort", abort);
        };
        this.waiters.push(wake);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    if (signal?.aborted) throw new Error("Run cancelled.");
    this.active++;
  }
  constructor(config) {
    this.limits = config.execution ?? { maxSpawns: 32, maxConcurrency: 3, timeoutMs: 18e5, maxAdvisorCalls: 0 };
  }
  wrap(engine) {
    const budget = this;
    return {
      ...engine,
      cli: engine.cli,
      capabilities: engine.capabilities,
      available: () => engine.available(),
      async *run(request, agentId) {
        if (request.signal?.aborted) throw new Error("Run cancelled.");
        if (budget.spawns >= budget.limits.maxSpawns) throw new BudgetExhausted("Execution budget exhausted: maxSpawns.");
        await budget.acquire(request.signal);
        try {
          if (budget.spawns >= budget.limits.maxSpawns) throw new BudgetExhausted("Execution budget exhausted: maxSpawns.");
          budget.spawns++;
          yield* engine.run(request, agentId);
        } finally {
          budget.active--;
          budget.waiters.shift()?.();
        }
      }
    };
  }
};

// src/orchestrator/run.ts
var ApplicationSchema = z3.object({ noteId: z3.string().min(1), requirementIds: z3.array(z3.string().min(1)).min(1), application: z3.string().min(1) }).strict();
var VerdictSchema = z3.object({ verdict: z3.enum(["pass", "fix"]), issues: z3.array(z3.string()) }).strict();
var exec2 = promisify2(execFile2);
var iso = (deps) => (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
async function orchestrate(goal, deps) {
  const runId = randomUUID();
  const budget = new RunBudget(deps.config);
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(new BudgetExhausted("Execution budget exhausted: timeoutMs.")), budget.limits.timeoutMs);
  timeout.unref();
  deps = { ...deps, signal: deps.signal ? AbortSignal.any([deps.signal, deadline.signal]) : deadline.signal };
  const events = [];
  const evidenceEvents = [];
  const allEvents = [];
  let harnessLevel = deps.harnessLevel ?? "H3";
  let activeDeps = deps;
  let methodSummary = "";
  const startCommit = await exec2("git", ["rev-parse", "HEAD"], { cwd: deps.cwd }).then((result) => result.stdout.trim()).catch(() => void 0);
  const rawEngineFactory = deps.engines;
  let terminalStatus = "blocked";
  const resolvedEngines = /* @__PURE__ */ new Map();
  const engineFor = (cli) => {
    let engine = resolvedEngines.get(cli);
    if (!engine) {
      engine = budget.wrap(measuredEngine(rawEngineFactory(cli)));
      resolvedEngines.set(cli, engine);
    }
    return engine;
  };
  deps = { ...deps, engines: engineFor };
  activeDeps = deps;
  const steps = [];
  const at = () => iso(deps);
  await mkdir2(deps.runsDir, { recursive: true });
  const emit = async (event) => {
    events.push(event);
    allEvents.push(event);
    const file = await open(join5(deps.runsDir, `${runId}.jsonl`), "a");
    try {
      await file.write(`${JSON.stringify(event)}
`, void 0, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await deps.onEvent(event);
  };
  const emitEvidence = async (event) => {
    evidenceEvents.push(event);
    events.push(event);
    allEvents.push(event);
    await appendFile(join5(deps.runsDir, `${runId}.jsonl`), `${JSON.stringify(event)}
`, "utf8");
    await deps.onEvent(event);
  };
  let composerClosed = false;
  const composerIterator = deps.composerMessages?.[Symbol.asyncIterator]();
  let composerEmission;
  const observeComposer = () => composerIterator ? (async () => {
    try {
      while (!composerClosed) {
        const next = await composerIterator.next();
        if (composerClosed || next.done) break;
        const avoidable = isAvoidableComposerMessage(next.value);
        composerEmission = emitEvidence({ type: "intervention", by: "user", action: "composer-message", detail: next.value, avoidable, harnessGap: avoidable ? "context" : "unknown", at: at() });
        await composerEmission;
      }
    } catch {
    }
  })() : void 0;
  const start = { type: "run.start", runId, goal, mode: deps.config.mode, at: at() };
  await emit(start);
  void observeComposer();
  let sessionId;
  let episodeClosed = false;
  let pack = { text: "", tokens: 0, budgetTokens: deps.config.context.budgetTokens, sections: [], deferred: [] };
  let requirements = [];
  let effectiveChecks = [];
  let registeredChecks = [];
  let registryInfo = "";
  let taskState = "";
  let taskStatePath;
  let workflowEvidence = "";
  let summary = "Run failed.";
  const limitations = [];
  const applications = /* @__PURE__ */ new Map();
  const suppliedNotes = /* @__PURE__ */ new Set();
  try {
    if (deps.signal?.aborted) throw new Error("Run cancelled before start.");
    if (deps.config.routing?.advisor && budget.limits.maxAdvisorCalls > 0 && !deps.autoApprove && deps.config.approvals !== "auto") {
      const cli = assignCli("advisor", deps.config, deps.available);
      if (engineFor(cli).capabilities?.readonly !== "enforced") throw new Error("Advisor requires enforced read-only execution.");
    }
    const playbook = await loadPlaybook(deps.playbookName ?? deps.config.playbook ?? "default", dirname(deps.runsDir));
    harnessLevel = deps.harnessLevel ?? playbook.harness;
    methodSummary = workerMethod(playbook);
    activeDeps = { ...deps, engines: engineFor, config: applyPlaybookRoles(deps.config, playbook) };
    if (harnessLevel === "H2" || harnessLevel === "H3") {
      pack = await deps.context.build({ query: goal, budgetTokens: deps.config.context.budgetTokens });
      for (const section of pack.sections) for (const noteId of section.noteIds) {
        if (pack.text.includes(`[[${noteId}]]`)) suppliedNotes.add(noteId);
        await emitEvidence({ type: "context.trace", noteId, contribution: section.title, influenced: false, at: at() });
      }
    }
    const session = await deps.brain.openSession(`Run: ${goal}`, "edu:orchestrator");
    sessionId = session.meta.id;
    await atomicWrite(join5(deps.runsDir, `${runId}.status.json`), `${JSON.stringify({ runId, cwd: deps.cwd, goal, sessionId, status: "running", summary: "Run started; inspect event log before resuming interrupted work.", steps, budget: { ...budget.limits, spawns: budget.spawns, advisorCalls: budget.advisorCalls }, updatedAt: at() }, null, 2)}
`);
    if (harnessLevel !== "H0") {
      const [tools, checks] = await Promise.all([loadTools(deps.cwd), loadChecks(deps.cwd)]);
      registeredChecks = checks;
      registryInfo = JSON.stringify({ tools, checks }, null, 2);
    }
    if (harnessLevel === "H2" || harnessLevel === "H3") {
      taskStatePath = join5(deps.runsDir, runId, "task-state.md");
      await mkdir2(dirname(taskStatePath), { recursive: true });
      taskState = `# Task state

## Goal
${goal}

## Hypotheses
- None recorded yet.

## Inspected files
- None recorded yet.

## Open questions
- None recorded yet.

## Next steps
- Planner is preparing the task plan.
`;
      await writeFile(taskStatePath, taskState, "utf8");
    }
    const leadId = `${runId}-lead`;
    for (const role of activeDeps.config.roles) {
      const cli = assignCli(role.id, activeDeps.config, deps.available);
      const capabilities = engineFor(cli).capabilities;
      if (role.autonomy === "readonly" && capabilities.readonly !== "enforced") limitations.push(`${role.id}/${cli}: readonly enforcement unsupported; steps run serially. ${capabilities.limitations.join(" ")}`);
    }
    const leadCli = assignCli("lead", activeDeps.config, deps.available);
    const planningMethod = `Playbook: ${playbook.name}
${playbook.description}

${playbook.body}`;
    const prompt = planningPrompt(goal, "", { harnessLevel, playbook: planningMethod });
    const planText = await runText(activeDeps, emit, leadCli, leadId, "lead", prompt, "readonly", supportContext(), methodSummary);
    let plan;
    try {
      plan = extractPlan(planText.text);
    } catch (first) {
      const repaired = await runText(activeDeps, emit, leadCli, `${leadId}-repair`, "lead", `${repairPrompt(planText.text, String(first))}

Follow this playbook method when planning:
${planningMethod}`, "readonly", supportContext(), methodSummary);
      try {
        plan = extractPlan(repaired.text);
      } catch (second) {
        throw new Error(`Unable to produce a valid plan after one repair: ${String(second)}`);
      }
    }
    await emit({ type: "agent.end", agentId: leadId, ok: true, summary: `Planned ${plan.steps.length} step(s).`, ...planText.sessionId ? { sessionId: planText.sessionId } : {}, at: at() });
    requirements = plan.requirements;
    await emitEvidence({ type: "task.define", requirements, successCriteria: requirements.map((requirement) => requirement.text), at: at() });
    effectiveChecks = resolveChecks(plan.checks, registeredChecks);
    if (harnessLevel === "H3") {
      const requirementIds = new Set(requirements.map((requirement) => requirement.id));
      const selectedIds = new Set(effectiveChecks.map((check) => check.id));
      for (const check of registeredChecks) {
        if (!check.requirementIds.some((requirementId) => requirementIds.has(requirementId)) || selectedIds.has(check.id)) continue;
        await emitEvidence({ type: "entropy.finding", category: "checks-bypassed", severity: 3, path: ".edu/harness/checks.json", detail: `Applicable registered check '${check.id}' was omitted from the H3 plan.`, at: at() });
      }
    }
    if (taskStatePath) {
      taskState = `# Task state

## Goal
${goal}

## Hypotheses
- None recorded yet.

## Inspected files
- None recorded yet.

## Open questions
- None recorded yet.

## Next steps
${plan.steps.map((step) => `- ${step.id}: ${step.task}`).join("\n") || "- Report the task outcome."}
`;
      await writeFile(taskStatePath, taskState, "utf8");
    }
    for (const step of plan.steps) {
      if (step.role !== "explorer" && step.role !== "builder" && step.role !== "reviewer") throw new Error(`Unsupported plan role '${step.role}' in step '${step.id}'.`);
    }
    const spec = await writeSpec(dirname(deps.runsDir), goal, playbook.name, harnessLevel, plan, activeDeps.config, deps.available, deps.now?.() ?? /* @__PURE__ */ new Date(), runId);
    await emit({ type: "spec.ready", path: spec.path, requirements, checks: plan.checks, steps: plan.steps.map((step) => ({ id: step.id, role: step.role, cli: assignCli(step.role, activeDeps.config, deps.available), task: step.task })), at: at() });
    const hasProposedChecks = plan.checks.some((check) => !registeredChecks.some((registered) => sameCheck(registered, check)));
    if (playbook.requireSpecApproval || hasProposedChecks) {
      const agentId = `${runId}-lead`;
      const approvalId = `${runId}-approval-spec`;
      await emit({ type: "approval.request", agentId, approvalId, title: "Approve spec", detail: spec.markdown, at: at() });
      let approved = false;
      try {
        approved = await awaitApproval(deps.approve({ agentId, stepId: "spec", title: "Approve spec", detail: spec.markdown }), deps.signal);
      } catch (error) {
        await emit({ type: "error", agentId, message: `Approval failed: ${String(error)}`, at: at() });
      }
      if (deps.signal?.aborted) throw new Error("Run cancelled while awaiting spec approval.");
      const policyApproval = deps.autoApprove || activeDeps.config.approvals === "auto";
      await emit({ type: "approval.resolve", approvalId, approved, by: policyApproval ? "policy" : "user", at: at() });
      if (!policyApproval) await recordApprovalIntervention(approved, "spec approval");
      if (!approved) {
        summary = "spec rejected";
        for (const step of plan.steps) steps.push({ id: step.id, ok: false, summary: "Not run because the spec was rejected.", skipped: true });
        await closeEpisode(sessionId, summary);
        return await finish(false);
      }
    }
    const approvals = plan.steps.filter((step) => needsApproval(activeDeps.config.approvals, activeDeps.config.roles.find((role) => role.id === step.role)?.autonomy ?? "readonly"));
    for (const step of approvals) {
      const agentId = `${runId}-${step.id}`;
      const approvalId = `${runId}-approval-${step.id}`;
      await emit({ type: "approval.request", agentId, approvalId, title: `Approve ${step.role} step`, detail: step.task, at: at() });
      let approved = false;
      try {
        approved = await awaitApproval(deps.approve({ agentId, stepId: step.id, title: `Approve ${step.role} step`, detail: step.task }), deps.signal);
      } catch (error) {
        await emit({ type: "error", agentId, message: `Approval failed: ${String(error)}`, at: at() });
      }
      if (deps.signal?.aborted) throw new Error("Run cancelled while awaiting approval.");
      await emit({ type: "approval.resolve", approvalId, approved, by: deps.autoApprove ? "policy" : "user", at: at() });
      if (!deps.autoApprove) await recordApprovalIntervention(approved, step.task);
      if (!approved) {
        for (const candidate of plan.steps) steps.push({ id: candidate.id, ok: false, summary: candidate.id === step.id ? "Approval rejected." : "Not run because approval was rejected.", skipped: true });
        summary = `Run stopped: approval rejected for step '${step.id}'.`;
        await closeEpisode(sessionId, summary);
        await emit({ type: "agent.status", agentId, status: "cancelled", at: at() });
        return await finish(false);
      }
    }
    if (harnessLevel === "H3") workflowEvidence = await reproduceChecks(effectiveChecks);
    const completed = /* @__PURE__ */ new Map();
    const pending = new Map(plan.steps.map((step) => [step.id, step]));
    while (pending.size) {
      if (deps.signal?.aborted) throw new Error("Run cancelled.");
      const ready = [...pending.values()].filter((step) => step.dependsOn.every((id) => completed.has(id)));
      if (!ready.length) throw new Error("Plan contains a dependency cycle or an unsatisfied dependency.");
      const first = ready[0];
      const firstRole = activeDeps.config.roles.find((role) => role.id === first.role);
      const enforcedReader = (step) => activeDeps.config.roles.find((role) => role.id === step.role)?.autonomy === "readonly" && engineFor(assignCli(step.role, activeDeps.config, deps.available)).capabilities?.readonly === "enforced";
      const firstReadonly = firstRole?.autonomy === "readonly" && enforcedReader(first);
      const batch = first.parallelSafe && firstReadonly ? ready.filter((step) => step.parallelSafe && enforcedReader(step)).slice(0, budget.limits.maxConcurrency) : [first];
      const batchController = new AbortController();
      const batchSignal = deps.signal ? AbortSignal.any([deps.signal, batchController.signal]) : batchController.signal;
      const settled = await Promise.allSettled(batch.map((step) => executeStep(step, batchSignal).catch((error) => {
        batchController.abort();
        throw error;
      })));
      const failed = settled.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        const outcome = result.value;
        pending.delete(outcome.id);
        steps.push(outcome);
        if (!outcome.ok) throw new Error(`Step '${outcome.id}' failed: ${outcome.summary}`);
        completed.set(outcome.id, outcome.summary);
        if (taskStatePath) {
          taskState += `
## Progress
- ${outcome.id}: ${outcome.ok ? "completed" : "failed"} \u2014 ${outcome.summary}
`;
          await writeFile(taskStatePath, taskState, "utf8");
        }
      }
    }
    let advisorEvidence = "";
    if (activeDeps.config.routing?.advisor && budget.limits.maxAdvisorCalls > 0) {
      if (deps.autoApprove || activeDeps.config.approvals === "auto") {
        limitations.push("Advisor skipped: consultation requires an explicit human disclosure approval.");
      } else {
        const advisorCli = assignCli("advisor", activeDeps.config, deps.available);
        if (engineFor(advisorCli).capabilities?.readonly !== "enforced") throw new Error("Advisor requires enforced read-only execution.");
        const detail = `Consult ${advisorCli} with the goal and requirement IDs only. This CLI may inspect the workspace read-only; this is not a tool-free advisor. Usage may be unavailable. No automatic follow-up consultations. The existing local run event log and episode package retain raw output (unlike sanitized Crew artifacts); workspace secrets could appear there. Do not approve for sensitive workspaces.`;
        const approvalId = `${runId}-approval-advisor`;
        await emit({ type: "approval.request", agentId: `${runId}-advisor`, approvalId, title: "Approve advisor disclosure", detail, at: at() });
        const approved = await awaitApproval(deps.approve({ agentId: `${runId}-advisor`, stepId: "advisor", title: "Approve advisor disclosure", detail }), deps.signal);
        await emit({ type: "approval.resolve", approvalId, approved, by: "user", at: at() });
        if (approved) {
          budget.advisorCalls++;
          const advice = await runText(activeDeps, emit, advisorCli, `${runId}-advisor`, "advisor", `Give one bounded second opinion on risks and verification. Do not delegate, modify files, or write memory. Goal: ${goal}
Requirement IDs: ${requirements.map((r) => r.id).join(", ")}`, "readonly", "", "");
          advisorEvidence = advice.text.slice(0, 4e3) + (advice.text.length > 4e3 ? "\n[Advisor output truncated; full consultation is in the run event log.]" : "");
          limitations.push(`Advisor consultation recorded in ${runId}.jsonl; advisory only (${advice.text.length} characters). Independent review remains mandatory.`);
        }
      }
    }
    const builder = activeDeps.config.roles.find((role) => role.id === "builder");
    let fixRounds = 0;
    let reviewRounds = 0;
    let verdict;
    while (true) {
      if (effectiveChecks.length) {
        let results = await verifyChecks(effectiveChecks);
        while (results.some((result) => !result.ok) && builder && fixRounds < playbook.maxFixRounds) {
          const round = ++fixRounds;
          const details = results.filter((result) => !result.ok).map((result) => {
            const check = effectiveChecks.find((candidate) => candidate.id === result.checkId);
            return `${check.id}: observed exit=${result.exitCode}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}, timeout=${result.timedOut}; expected exit=${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === void 0 ? "" : `, stdout includes ${JSON.stringify(check.expect.stdoutIncludes)}`}`;
          }).join("\n");
          if (needsApproval(activeDeps.config.approvals, builder.autonomy)) {
            const agentId = `${runId}-verification-fix-${round}`;
            const approvalId = `${runId}-approval-verification-fix-${round}`;
            const title = "Approve deterministic-verification correction";
            const detail = `A deterministic check failed; authorize bounded builder correction ${round}/${playbook.maxFixRounds}.
${details}`;
            await emit({ type: "approval.request", agentId, approvalId, title, detail, at: at() });
            let approved = false;
            try {
              approved = await awaitApproval(deps.approve({ agentId, stepId: `verification-fix-${round}`, title, detail }), deps.signal);
            } catch (error) {
              await emit({ type: "error", agentId, message: `Approval failed: ${String(error)}`, at: at() });
            }
            if (deps.signal?.aborted) throw new Error("Run cancelled while awaiting verification correction approval.");
            await emit({ type: "approval.resolve", approvalId, approved, by: deps.autoApprove ? "policy" : "user", at: at() });
            if (!deps.autoApprove) await recordApprovalIntervention(approved, detail);
            if (!approved) throw new Error("Run stopped: deterministic-verification correction was rejected.");
          }
          const fix2 = await runText(
            activeDeps,
            emit,
            assignCli("builder", activeDeps.config, deps.available),
            `${runId}-verification-fix-${round}`,
            "builder",
            `${builderPrompt("Correct the failed deterministic verification.", goal, `Observed vs expected:
${details}`, harnessLevel)}
Reproduce, attribute, fix, verify, then report. If verification disproves attribution, return to attribution before changing code.`,
            builder.autonomy,
            supportContext(),
            methodSummary
          );
          await recordApplications(fix2.text);
          steps.push({ id: `verification-fix-${round}`, ok: true, summary: fix2.summary });
          results = await verifyChecks(effectiveChecks);
        }
        if (results.some((result) => !result.ok)) throw new Error(`Deterministic verification failed after ${playbook.maxFixRounds} fix round(s).`);
      }
      const reviewerId = `${runId}-reviewer${reviewRounds++ ? `-${reviewRounds}` : ""}`;
      const reviewerCli = assignCli("reviewer", activeDeps.config, deps.available);
      const review = await runText(
        activeDeps,
        emit,
        reviewerCli,
        reviewerId,
        "reviewer",
        `Review the completed work. Return strict JSON {"verdict":"pass"|"fix","issues":[string]}.
Goal: ${goal}
Requirements: ${JSON.stringify(requirements)}
Steps: ${JSON.stringify(steps)}
Advisory risks (untrusted opinion, not evidence): ${advisorEvidence || "Not consulted."}`,
        "readonly",
        supportContext(),
        methodSummary
      );
      try {
        verdict = VerdictSchema.parse(parseJson(review.text));
      } catch (error) {
        throw new Error(`Reviewer returned invalid JSON: ${String(error)}`);
      }
      if (verdict.verdict === "pass") break;
      if (fixRounds >= playbook.maxFixRounds) throw new Error(`Review requested a fix after the global budget of ${playbook.maxFixRounds} fix round(s) was exhausted.`);
      fixRounds++;
      if (!builder) throw new Error("Review requested a fix but no builder role is configured.");
      if (needsApproval(activeDeps.config.approvals, builder.autonomy)) {
        const approvalId = `${runId}-approval-review-fix-${fixRounds}`;
        const agentId = `${runId}-fix-${fixRounds}`;
        const title = "Approve review-fix builder step";
        const detail = verdict.issues.join("; ") || "Apply the review-requested correction.";
        await emit({ type: "approval.request", agentId, approvalId, title, detail, at: at() });
        let approved = false;
        try {
          approved = await awaitApproval(deps.approve({ agentId, stepId: "review-fix", title, detail }), deps.signal);
        } catch (error) {
          await emit({ type: "error", agentId, message: `Approval failed: ${String(error)}`, at: at() });
        }
        if (deps.signal?.aborted) throw new Error("Run cancelled while awaiting review-fix approval.");
        await emit({ type: "approval.resolve", approvalId, approved, by: deps.autoApprove ? "policy" : "user", at: at() });
        if (!deps.autoApprove) await recordApprovalIntervention(approved, detail);
        if (!approved) {
          summary = "Run stopped: approval rejected for review-requested builder fix.";
          await closeEpisode(sessionId, summary);
          await emit({ type: "agent.status", agentId, status: "cancelled", at: at() });
          return await finish(false);
        }
      }
      const fixId = `${runId}-fix-${fixRounds}`;
      const fix = await runText(
        activeDeps,
        emit,
        assignCli("builder", activeDeps.config, deps.available),
        fixId,
        "builder",
        `${builderPrompt(`Address these review issues in one fix round only: ${JSON.stringify(verdict.issues)}`, goal, workflowEvidence, harnessLevel)}
Completed steps: ${JSON.stringify([...completed])}`,
        builder.autonomy,
        supportContext(),
        methodSummary
      );
      await recordApplications(fix.text);
      steps.push({ id: reviewRounds === 1 ? "review-fix" : `review-fix-${fixRounds}`, ok: true, summary: fix.summary });
    }
    summary = `Completed ${steps.length} step(s); review ${verdict.verdict}${verdict.issues.length ? `: ${verdict.issues.join("; ")}` : ""}.`;
    await closeEpisode(sessionId, summary);
    return await finish(true);
  } catch (error) {
    terminalStatus = error instanceof BudgetExhausted || deadline.signal.aborted ? "budget_exhausted" : deps.signal?.aborted ? "cancelled" : "blocked";
    summary = deadline.signal.aborted ? "Execution budget exhausted: timeoutMs." : error instanceof Error ? error.message : String(error);
    if (sessionId) await closeEpisode(sessionId, summary).catch(() => {
    });
    await emit({ type: "error", message: summary, at: at() });
    return await finish(false);
  }
  async function executeStep(step, signal) {
    const role = activeDeps.config.roles.find((candidate) => candidate.id === step.role);
    const cli = assignCli(step.role, activeDeps.config, deps.available);
    const agentId = `${runId}-${step.id}`;
    const dependencyContext = step.dependsOn.map((id) => `${id}: ${steps.find((item) => item.id === id)?.summary ?? ""}`).join("\n");
    const prompt = step.role === "builder" ? `${builderPrompt(step.task, goal, workflowEvidence, harnessLevel)}

Dependencies:
${dependencyContext}` : `${step.task}

Goal: ${goal}

Dependencies:
${dependencyContext}`;
    const response = await runText(activeDeps, emit, cli, agentId, step.role, prompt, role?.autonomy ?? "readonly", supportContext(), methodSummary, signal);
    if (step.role === "builder") await recordApplications(response.text);
    return { id: step.id, ok: true, summary: response.summary || response.text };
  }
  async function closeEpisode(id, text) {
    if (!id || episodeClosed) return;
    await deps.brain.closeSession(id, text);
    episodeClosed = true;
    await emit({ type: "brain.learn", noteId: id, kind: "episode", title: `Run: ${goal}`, at: at() });
    await atomicWrite(join5(dirname(deps.runsDir), "reflect-queue", `${runId}.json`), `${JSON.stringify({ runId, sessionId: id, queuedAt: at() }, null, 2)}
`);
  }
  async function finish(success) {
    clearTimeout(timeout);
    await persistStatus(false, "Finalization pending; consult the event log if interrupted.");
    composerClosed = true;
    try {
      void Promise.resolve(composerIterator?.return?.()).catch(() => {
      });
    } catch {
    }
    await composerEmission?.catch(() => {
    });
    let entropyUnsafe = false;
    if (startCommit) {
      try {
        const audit = await auditGitDiff(deps.cwd, startCommit, requirements.map((requirement) => requirement.id));
        entropyUnsafe = audit.findings.some((finding) => ["weakened-tests", "checks-bypassed", "unsafe-invalid"].includes(finding.category));
        for (const finding of audit.findings) {
          await emitEvidence({ type: "entropy.finding", ...finding, at: at() });
        }
      } catch (error) {
        limitations.push(`Git diff entropy audit unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      limitations.push("Git start commit unavailable; entropy audit was not run.");
    }
    entropyUnsafe ||= allEvents.some((event) => event.type === "entropy.finding" && ["weakened-tests", "checks-bypassed", "unsafe-invalid"].includes(event.category));
    const latestChecks = /* @__PURE__ */ new Map();
    for (const event of evidenceEvents) if (event.type === "verify.result" && event.kind === "deterministic" && event.checkId) latestChecks.set(event.checkId, event);
    const verifiedRequirements = requirements.filter((requirement) => {
      const checks = effectiveChecks.filter((check) => check.requirementIds.includes(requirement.id));
      return checks.length > 0 && checks.every((check) => latestChecks.get(check.id)?.ok && !latestChecks.get(check.id)?.timedOut);
    }).map((requirement) => requirement.id);
    const verified = requirements.length > 0 && verifiedRequirements.length === requirements.length;
    success &&= [...latestChecks.values()].every((result) => result.ok && !result.timedOut);
    const hasIntervention = evidenceEvents.some((event) => event.type === "intervention" || event.type === "approval.resolve" && event.by !== "policy");
    let label = entropyUnsafe ? "unsafe_invalid" : !success ? "failed" : !verified ? "unverified_success" : hasIntervention ? "assisted_verified_success" : "autonomous_verified_success";
    const outcome = { type: "outcome", label, metrics: { harnessLevel, cli: activeDeps.config.defaultCli, role: "builder", verifiedRequirements, entropySeverity: evidenceEvents.filter((event) => event.type === "entropy.finding").reduce((severity, event) => Math.max(severity, event.severity), 0), elapsedMs: Date.parse(at()) - Date.parse(events[0]?.at ?? at()) }, at: at() };
    const end = { type: "run.end", runId, ok: success, summary, at: at() };
    const episodeDir = await buildEpisodePackage(dirname(deps.runsDir), runId, [...allEvents, outcome, end], { limitations: [...limitations, ...success ? [] : [summary]] });
    const classification = await diagnosePackage(episodeDir);
    outcome.label = label = classification.label;
    if (label === "failed" && success) {
      success = false;
      end.ok = false;
      end.summary = summary = `Episode verification failed: ${classification.reasons.join("; ")}`;
    }
    await emitEvidence(outcome);
    if (success && label !== "unsafe_invalid" && !deps.signal?.aborted) for (const [noteId, application] of applications) {
      const relevant = effectiveChecks.filter((check) => check.requirementIds.some((id) => application.requirementIds.includes(id)));
      const covered = application.requirementIds.every((id) => relevant.some((check) => check.requirementIds.includes(id)));
      const passed = relevant.length > 0 && relevant.every((check) => latestChecks.get(check.id)?.ok && !latestChecks.get(check.id)?.timedOut);
      if (!covered || !passed) continue;
      const feedback = {
        // The persistent ledger is per note; keep its event key bounded regardless of note ID length.
        eventId: `${runId}:${label}`,
        verified: true,
        evidence: [`application:${application.application}`, ...relevant.map((check) => `deterministic-check:${check.id}`)]
      };
      try {
        await deps.brain.feedback(noteId, true, feedback);
      } catch (error) {
        limitations.push(`Feedback for ${noteId} unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await emit(end);
    await buildEpisodePackage(dirname(deps.runsDir), runId, allEvents, { limitations: [...limitations, ...success ? [] : [summary]] });
    await persistStatus(success, summary);
    await autoMaintain(deps.brain, dirname(deps.runsDir), { now: deps.now?.() ?? /* @__PURE__ */ new Date() }).catch(() => void 0);
    return { runId, ok: success, summary, events, steps, episodeDir };
  }
  async function persistStatus(success, detail) {
    await atomicWrite(join5(deps.runsDir, `${runId}.status.json`), `${JSON.stringify({ runId, cwd: deps.cwd, goal, sessionId, status: success ? "completed" : terminalStatus, summary: detail, steps, budget: { ...budget.limits, spawns: budget.spawns, advisorCalls: budget.advisorCalls }, updatedAt: at() }, null, 2)}
`);
  }
  async function recordApprovalIntervention(approved, detail) {
    const avoidable = !approved && isAvoidableComposerMessage(detail);
    await emitEvidence({ type: "intervention", by: "user", action: approved ? "approval:approved" : "approval:rejected", detail, avoidable, harnessGap: avoidable ? "feedback" : "unknown", at: at() });
  }
  async function reproduceChecks(checks) {
    if (!checks.length) return "";
    const results = await Promise.all(checks.map((check) => executeCheck(check)));
    for (const result of results) {
      const check = checks.find((candidate) => candidate.id === result.checkId);
      await emitEvidence({ type: "verify.result", checkId: result.checkId, requirementIds: check.requirementIds, ok: result.ok, output: result.output, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, kind: "reproduction", at: at() });
      if (!result.ok) await emitCheckAttribution(check, result);
    }
    return results.map((result) => `${result.checkId}: ${result.ok ? "passed" : "failed"} \u2014 ${result.output}`).join("\n");
  }
  async function verifyChecks(checks) {
    const results = await Promise.all(checks.map((check) => executeCheck(check)));
    for (const result of results) {
      const check = checks.find((candidate) => candidate.id === result.checkId);
      await emitEvidence({ type: "verify.result", checkId: result.checkId, requirementIds: check.requirementIds, ok: result.ok, output: result.output, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, kind: "deterministic", at: at() });
      if (!result.ok) await emitCheckAttribution(check, result);
    }
    return results;
  }
  async function executeCheck(check) {
    const callId = `${runId}-check-${check.id}-${randomUUID()}`;
    await emit({ type: "tool.call", agentId: `${runId}-h3-checks`, callId, tool: "deterministic-check", input: JSON.stringify({ checkId: check.id, command: check.command }), at: at() });
    const result = await runCheck(check, deps.cwd, deps.signal);
    await emit({ type: "tool.result", agentId: `${runId}-h3-checks`, callId, ok: result.ok, output: JSON.stringify({ exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr }), at: at() });
    return result;
  }
  async function emitCheckAttribution(check, result) {
    await emitEvidence({
      type: "failure.attribution",
      failureType: "verify",
      observed: `Check '${check.id}' exited ${result.exitCode ?? "without an exit code"}${result.timedOut ? " after timing out" : ""}; stdout=${JSON.stringify(result.stdout)}; stderr=${JSON.stringify(result.stderr)}.`,
      expected: `Expected exit code ${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === void 0 ? "" : ` and stdout to include ${JSON.stringify(check.expect.stdoutIncludes)}`}.`,
      evidence: [`registered-check:${check.id}`, `exitCode:${result.exitCode ?? "null"}`, `timedOut:${result.timedOut}`, `stdout:${result.stdout}`, `stderr:${result.stderr}`],
      alternatives: [],
      next: "Inspect the captured check evidence and identify the cause before making a correction.",
      at: at()
    });
  }
  async function recordApplications(text) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("EDU_APPLIED ")) continue;
      let value;
      try {
        value = JSON.parse(line.slice("EDU_APPLIED ".length));
      } catch {
        continue;
      }
      const parsed = ApplicationSchema.safeParse(value);
      if (!parsed.success) continue;
      const entry = parsed.data;
      if (!suppliedNotes.has(entry.noteId) || !entry.application.includes(`[[${entry.noteId}]]`) || !entry.requirementIds.every((id) => requirements.some((requirement) => requirement.id === id))) continue;
      const previous = applications.get(entry.noteId);
      applications.set(entry.noteId, { requirementIds: [.../* @__PURE__ */ new Set([...previous?.requirementIds ?? [], ...entry.requirementIds])], application: previous ? `${previous.application}
${entry.application}` : entry.application });
      if (!previous) await emitEvidence({ type: "context.trace", noteId: entry.noteId, contribution: entry.application, influenced: true, at: at() });
    }
  }
  function supportContext() {
    const sections = [];
    if (harnessLevel !== "H0") sections.push(`Tool and check registry:
${registryInfo || "No registered tools or checks."}`);
    if (harnessLevel === "H2" || harnessLevel === "H3") {
      if (pack.text) sections.push(`Brain context pack:
${pack.text}`);
      if (taskState) sections.push(`Task state:
${taskState}`);
    }
    return sections.join("\n\n");
  }
}
function needsApproval(policy, autonomy) {
  return policy === "always-ask" || policy === "ask-on-write" && (autonomy === "auto" || autonomy === "full");
}
async function awaitApproval(approval, signal) {
  if (!signal) return approval;
  if (signal.aborted) throw new Error("Run cancelled while awaiting approval.");
  return Promise.race([approval, new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Run cancelled while awaiting approval.")), { once: true });
  })]);
}
function parseJson(value) {
  const match = value.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  try {
    return JSON.parse(match?.[1]?.trim() ?? value.trim());
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function runText(deps, emit, cli, agentId, roleId, prompt, autonomy, context, methodSummary = "", signal = deps.signal) {
  const role = deps.config.roles.find((candidate) => candidate.id === roleId);
  const model = roleRoute(roleId, deps.config)?.model ?? role?.model;
  await emit({ type: "agent.spawn", agentId, role: roleId, cli, task: prompt.slice(0, 160), at: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString() });
  await emit({ type: "agent.status", agentId, status: "running", at: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString() });
  const purpose = agentId.includes("fix") || agentId.endsWith("-repair") || prompt.includes("Invalid plan") || prompt.startsWith("Your previous") ? "recovery" : roleId === "lead" ? "planning" : roleId === "reviewer" ? "review" : "task";
  const request = { invocation: { id: randomUUID(), purpose }, cli, prompt: `${prompt}

Context pack:
${context}`, cwd: deps.cwd, autonomy, systemPrompt: [role?.mission, roleId === "lead" ? "" : methodSummary, roleId === "builder" && context.includes("Brain context pack:") ? 'If you actually apply a supplied note, cite it explicitly on a separate line: EDU_APPLIED {"noteId":"L-id","requirementIds":["R-1"],"application":"Applied [[L-id]] by ..."}. Report only concrete application, never mere exposure or presumed benefit.' : ""].filter(Boolean).join("\n\n"), ...model ? { model } : {}, signal };
  let text = "";
  let summary = "";
  let sessionId;
  try {
    for await (const event of measuredEngine(deps.engines(cli)).run(request, agentId)) {
      const stamped = { ...event, at: event.at || (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString() };
      if (stamped.type === "agent.text") text += stamped.text;
      if (stamped.type === "agent.end") {
        summary = stamped.summary;
        sessionId = stamped.sessionId;
      }
      await emit(stamped);
      if (signal?.aborted) throw new Error("Run cancelled.");
      if (stamped.type === "error") throw new Error(`Engine reported an error: ${stamped.message}`);
      if (stamped.type === "agent.end" && !stamped.ok) throw new Error(`Engine run failed: ${stamped.summary}`);
    }
    if (signal?.aborted) throw new Error("Run cancelled.");
    return { text, summary, ...sessionId ? { sessionId } : {} };
  } catch (error) {
    await emit({ type: "agent.status", agentId, status: signal?.aborted ? "cancelled" : "failed", at: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString() });
    throw error;
  }
}
function resolveChecks(planned, registered) {
  const byId = new Map(registered.map((check) => [check.id, check]));
  return planned.map((check) => {
    const configured = byId.get(check.id);
    if (configured && !sameCheck(configured, check)) {
      throw new Error(`Plan check '${check.id}' reuses a registered ID but changes its definition.`);
    }
    return configured ?? check;
  });
}
function sameCheck(left, right) {
  return left.id === right.id && left.command === right.command && left.timeoutMs === right.timeoutMs && JSON.stringify(left.requirementIds) === JSON.stringify(right.requirementIds) && left.expect.exitCode === right.expect.exitCode && left.expect.stdoutIncludes === right.expect.stdoutIncludes;
}
function builderPrompt(task, goal, priorEvidence, level) {
  const workflow = level === "H3" ? "Use the H3 workflow: reproduce \u2192 attribute \u2192 fix \u2192 verify \u2192 report. Edu runs deterministic checks; if verification disproves the diagnosis, use the back-edge to attribution before the bounded correction." : "";
  return [task, `Goal:
${goal}`, priorEvidence ? `Prior reproduction evidence:
${priorEvidence}` : "", workflow].filter(Boolean).join("\n\n");
}
function isAvoidableComposerMessage(message) {
  return /\b(?:missing|forgot|should have|please include|must include|wrong path|use the file)\b/i.test(message);
}
export {
  EduConfigSchema,
  PlanSchema,
  applyPlaybookRoles,
  assignCli,
  defaultConfig,
  extractJson,
  extractPlan,
  loadConfig,
  loadPlaybook,
  orchestrate,
  planningPrompt,
  saveConfig,
  workerMethod
};
//# sourceMappingURL=orchestrator-EBDBKGJO.js.map