import {
  CheckSchema,
  diagnosePackage,
  loadChecks,
  loadTools,
  runCheck
} from "./chunk-XFCTCSCV.js";
import {
  autoMaintain
} from "./chunk-ST6WY46H.js";
import "./chunk-B7KZAX6U.js";
import {
  measuredEngine
} from "./chunk-5G4RNW33.js";
import "./chunk-6GXTQRCF.js";
import {
  packageTemplatesDir
} from "./chunk-NMJNTHQG.js";
import "./chunk-RPDI7AOO.js";
import {
  truncateToTokens
} from "./chunk-ICQNXX6J.js";
import "./chunk-VXIEHENV.js";
import {
  capRoleAutonomy
} from "./chunk-4ICAQNK7.js";
import {
  atomicWrite,
  slugify
} from "./chunk-KVVJCXPU.js";
import "./chunk-YPR7PZSQ.js";
import {
  HUMAN_APPROVERS,
  parseFrontmatter
} from "./chunk-X74ZO2KX.js";

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

// src/orchestrator/run/checks.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/orchestrator/run/state.ts
import { appendFile, mkdir, open, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { hostname } from "os";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

// src/orchestrator/run/gates.ts
function needsApproval(policy, autonomy) {
  return policy === "always-ask" || policy === "ask-on-write" && (autonomy === "auto" || autonomy === "full");
}
var isHuman = (by) => HUMAN_APPROVERS.includes(by);
function answerOf(value, fallback) {
  return typeof value === "boolean" ? { approved: value, by: fallback } : { approved: value.approved === true, by: value.by };
}
async function awaitApproval(approval, signal) {
  if (!signal) return approval;
  if (signal.aborted) throw new Error("Run cancelled while awaiting approval.");
  return Promise.race([approval, new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Run cancelled while awaiting approval.")), { once: true });
  })]);
}
async function askApproval(run, gate) {
  const { deps } = run;
  const { agentId, approvalId, stepId, title, detail } = gate;
  await emit(run, { type: "approval.request", agentId, approvalId, title, detail, ...gate.unregisteredChecks?.length ? { unregisteredChecks: gate.unregisteredChecks } : {}, at: at(run) });
  let answer = { approved: false, by: gate.fallback ?? (deps.autoApprove ? "policy" : "user") };
  try {
    answer = answerOf(await awaitApproval(deps.approve({ agentId, stepId, title, detail }), deps.signal), answer.by);
  } catch (error) {
    await emit(run, { type: "error", agentId, message: `Approval failed: ${String(error)}`, at: at(run) });
  }
  if (deps.signal?.aborted) throw new Error(gate.cancelled);
  await emit(run, { type: "approval.resolve", approvalId, approved: answer.approved, by: answer.by, at: at(run) });
  if (isHuman(answer.by)) await recordApprovalIntervention(run, answer.approved, gate.interventionDetail ?? detail);
  return answer;
}
async function recordApprovalIntervention(run, approved, detail) {
  const avoidable = !approved && isAvoidableComposerMessage(detail);
  await emitEvidence(run, { type: "intervention", by: "user", action: approved ? "approval:approved" : "approval:rejected", detail, avoidable, harnessGap: avoidable ? "feedback" : "unknown", at: at(run) });
}
function isAvoidableComposerMessage(message) {
  return /\b(?:missing|forgot|should have|please include|must include|wrong path|use the file)\b/i.test(message);
}

// src/orchestrator/run/state.ts
var exec = promisify(execFile);
async function startRun(goal, input) {
  const runId = randomUUID();
  const budget = new RunBudget(input.config);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new BudgetExhausted("Execution budget exhausted: timeoutMs.")), budget.limits.timeoutMs);
  timer.unref();
  const signal = input.signal ? AbortSignal.any([input.signal, deadline.signal]) : deadline.signal;
  const startCommit = await exec("git", ["rev-parse", "HEAD"], { cwd: input.cwd }).then((result) => result.stdout.trim()).catch(() => void 0);
  const engines = /* @__PURE__ */ new Map();
  const engineFor = (cli) => {
    let engine = engines.get(cli);
    if (!engine) {
      engine = budget.wrap(measuredEngine(input.engines(cli)));
      engines.set(cli, engine);
    }
    return engine;
  };
  const deps = { ...input, signal, engines: engineFor };
  await mkdir(deps.runsDir, { recursive: true });
  const run = {
    runId,
    goal,
    deps,
    config: deps.config,
    budget,
    deadline: deadline.signal,
    timer,
    startCommit,
    composer: composerObserver(deps.composerMessages),
    harnessLevel: deps.harnessLevel ?? "H3",
    methodSummary: "",
    terminalStatus: "blocked",
    episodeClosed: false,
    pack: { text: "", tokens: 0, budgetTokens: deps.config.context.budgetTokens, sections: [], deferred: [] },
    requirements: [],
    registeredChecks: [],
    effectiveChecks: [],
    registryInfo: "",
    taskState: "",
    workflowEvidence: "",
    summary: "Run failed.",
    events: [],
    evidenceEvents: [],
    steps: [],
    limitations: [],
    applications: /* @__PURE__ */ new Map(),
    suppliedNotes: /* @__PURE__ */ new Set()
  };
  await emit(run, { type: "run.start", runId, goal, mode: deps.config.mode, at: at(run) });
  run.composer.start((message) => {
    const avoidable = isAvoidableComposerMessage(message);
    return emitEvidence(run, { type: "intervention", by: "user", action: "composer-message", detail: message, avoidable, harnessGap: avoidable ? "context" : "unknown", at: at(run) });
  });
  return run;
}
var at = (run) => (run.deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
async function emit(run, event) {
  run.events.push(event);
  const file = await open(join(run.deps.runsDir, `${run.runId}.jsonl`), "a");
  try {
    await file.write(`${JSON.stringify(event)}
`, void 0, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await run.deps.onEvent(event);
}
async function emitEvidence(run, event) {
  run.evidenceEvents.push(event);
  run.events.push(event);
  await appendFile(join(run.deps.runsDir, `${run.runId}.jsonl`), `${JSON.stringify(event)}
`, "utf8");
  await run.deps.onEvent(event);
}
async function writeStatus(run, status, summary) {
  const { runId, goal, sessionId, steps, budget, deps } = run;
  await atomicWrite(join(deps.runsDir, `${runId}.status.json`), `${JSON.stringify({ runId, cwd: deps.cwd, goal, sessionId, status, owner: { pid: process.pid, host: hostname() }, summary, steps, budget: { ...budget.limits, spawns: budget.spawns, advisorCalls: budget.advisorCalls }, updatedAt: at(run) }, null, 2)}
`);
}
function persistStatus(run, success, detail) {
  return writeStatus(run, success ? "completed" : run.terminalStatus, detail);
}
async function closeEpisode(run, text) {
  const id = run.sessionId;
  if (!id || run.episodeClosed) return;
  await run.deps.brain.closeSession(id, text);
  run.episodeClosed = true;
  await emit(run, { type: "brain.learn", noteId: id, kind: "episode", title: `Run: ${run.goal}`, at: at(run) });
  await atomicWrite(join(dirname(run.deps.runsDir), "reflect-queue", `${run.runId}.json`), `${JSON.stringify({ runId: run.runId, sessionId: id, queuedAt: at(run) }, null, 2)}
`);
}
function taskStateMarkdown(goal, nextSteps) {
  return `# Task state

## Goal
${goal}

## Hypotheses
- None recorded yet.

## Inspected files
- None recorded yet.

## Open questions
- None recorded yet.

## Next steps
${nextSteps}
`;
}
async function saveTaskState(run, text) {
  if (!run.taskStatePath) return;
  run.taskState = text;
  await writeFile(run.taskStatePath, text, "utf8");
}
function supportContext(run) {
  const sections = [];
  if (run.harnessLevel !== "H0") sections.push(`Tool and check registry:
${run.registryInfo || "No registered tools or checks."}`);
  if (run.harnessLevel === "H2" || run.harnessLevel === "H3") {
    if (run.pack.text) sections.push(`Brain context pack:
${run.pack.text}`);
    if (run.taskState) sections.push(`Task state:
${run.taskState}`);
  }
  return sections.join("\n\n");
}
function composerObserver(messages) {
  const iterator = messages?.[Symbol.asyncIterator]();
  let closed = false;
  let emission;
  return {
    start(record) {
      if (!iterator) return;
      void (async () => {
        try {
          while (!closed) {
            const next = await iterator.next();
            if (closed || next.done) break;
            emission = record(next.value);
            await emission;
          }
        } catch {
        }
      })();
    },
    async close() {
      closed = true;
      try {
        void Promise.resolve(iterator?.return?.()).catch(() => {
        });
      } catch {
      }
      await emission?.catch(() => {
      });
    }
  };
}

// src/orchestrator/run/checks.ts
async function reproduceChecks(run, checks) {
  if (!checks.length) return "";
  const results = await runChecks(run, checks, "reproduction");
  return results.map((result) => `${result.checkId}: ${result.ok ? "passed" : "failed"} \u2014 ${result.output}`).join("\n");
}
function verifyChecks(run, checks) {
  return runChecks(run, checks, "deterministic");
}
async function runChecks(run, checks, kind) {
  const results = await Promise.all(checks.map((check) => executeCheck(run, check)));
  for (const result of results) {
    const check = checks.find((candidate) => candidate.id === result.checkId);
    await emitEvidence(run, { type: "verify.result", checkId: result.checkId, requirementIds: check.requirementIds, ok: result.ok, output: result.output, exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, kind, at: at(run) });
    if (!result.ok) await emitCheckAttribution(run, check, result);
  }
  return results;
}
async function executeCheck(run, check) {
  const agentId = `${run.runId}-h3-checks`;
  const callId = `${run.runId}-check-${check.id}-${randomUUID2()}`;
  await emit(run, { type: "tool.call", agentId, callId, tool: "deterministic-check", input: JSON.stringify({ checkId: check.id, command: check.command }), at: at(run) });
  const result = await runCheck(check, run.deps.cwd, run.deps.signal);
  await emit(run, { type: "tool.result", agentId, callId, ok: result.ok, output: JSON.stringify({ exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr }), at: at(run) });
  return result;
}
async function emitCheckAttribution(run, check, result) {
  await emitEvidence(run, {
    type: "failure.attribution",
    failureType: "verify",
    observed: `Check '${check.id}' exited ${result.exitCode ?? "without an exit code"}${result.timedOut ? " after timing out" : ""}; stdout=${JSON.stringify(result.stdout)}; stderr=${JSON.stringify(result.stderr)}.`,
    expected: `Expected exit code ${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === void 0 ? "" : ` and stdout to include ${JSON.stringify(check.expect.stdoutIncludes)}`}.`,
    evidence: [`registered-check:${check.id}`, `exitCode:${result.exitCode ?? "null"}`, `timedOut:${result.timedOut}`, `stdout:${result.stdout}`, `stderr:${result.stderr}`],
    alternatives: [],
    next: "Inspect the captured check evidence and identify the cause before making a correction.",
    at: at(run)
  });
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

// src/orchestrator/run/approve.ts
async function approvePhase(run, playbook, { plan, spec }) {
  const { runId, deps } = run;
  const unregistered = run.effectiveChecks.filter((check) => !run.registeredChecks.some((registered) => sameCheck(registered, check)));
  let unregisteredApproved = Boolean(deps.allowUnregisteredChecks);
  if (playbook.requireSpecApproval || unregistered.length) {
    const detail = unregistered.length && !deps.allowUnregisteredChecks ? `Unregistered checks: approving runs these exact commands through the shell in ${deps.cwd}:
${unregistered.map((check) => `- ${check.id}: ${check.command}`).join("\n")}

${spec.markdown}` : spec.markdown;
    const policyApproval = deps.autoApprove || run.config.approvals === "auto";
    const answer = await askApproval(run, {
      agentId: `${runId}-lead`,
      approvalId: `${runId}-approval-spec`,
      stepId: "spec",
      title: "Approve spec",
      detail,
      unregisteredChecks: unregistered.map((check) => check.command),
      interventionDetail: "spec approval",
      cancelled: "Run cancelled while awaiting spec approval.",
      fallback: policyApproval ? "policy" : "user"
    });
    unregisteredApproved ||= answer.approved && !deps.autoApprove && answer.by !== "host-llm";
    if (!answer.approved) {
      run.summary = "spec rejected";
      for (const step of plan.steps) run.steps.push({ id: step.id, ok: false, summary: "Not run because the spec was rejected.", skipped: true });
      await closeEpisode(run, run.summary);
      return false;
    }
  }
  if (unregistered.length && !unregisteredApproved) {
    run.effectiveChecks = run.effectiveChecks.filter((check) => !unregistered.includes(check));
    run.limitations.push(`Unregistered check(s) not run: ${unregistered.map((check) => check.id).join(", ")}. They need a person to approve the spec that lists them, or --allow-unregistered-checks; register them in .edu/harness/checks.json to run them every time.`);
  }
  const gated = plan.steps.filter((step) => needsApproval(run.config.approvals, run.config.roles.find((role) => role.id === step.role)?.autonomy ?? "readonly"));
  for (const step of gated) {
    const agentId = `${runId}-${step.id}`;
    const { approved } = await askApproval(run, {
      agentId,
      approvalId: `${runId}-approval-${step.id}`,
      stepId: step.id,
      title: `Approve ${step.role} step`,
      detail: step.task,
      cancelled: "Run cancelled while awaiting approval."
    });
    if (!approved) {
      for (const candidate of plan.steps) run.steps.push({ id: candidate.id, ok: false, summary: candidate.id === step.id ? "Approval rejected." : "Not run because approval was rejected.", skipped: true });
      run.summary = `Run stopped: approval rejected for step '${step.id}'.`;
      await closeEpisode(run, run.summary);
      await emit(run, { type: "agent.status", agentId, status: "cancelled", at: at(run) });
      return false;
    }
  }
  return true;
}

// src/orchestrator/run/brief.ts
import { mkdir as mkdir2 } from "fs/promises";
import { dirname as dirname2, join as join3 } from "path";

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

// src/orchestrator/playbook.ts
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join as join2 } from "path";
import { z } from "zod";
var RoleOverrideSchema = z.object({
  title: z.string().optional(),
  icon: z.string().optional(),
  mission: z.string().optional(),
  autonomy: z.enum(["readonly", "ask", "auto", "full"]).optional(),
  cli: z.enum(["claude", "codex", "pi", "opencode", "agy"]).optional(),
  model: z.string().optional()
}).strict();
var FrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  roles: z.record(z.string(), RoleOverrideSchema).optional(),
  harness: z.enum(["H0", "H1", "H2", "H3"]).default("H3"),
  requireSpecApproval: z.boolean().default(true),
  maxFixRounds: z.number().int().min(0).max(5).default(1)
}).strict();
async function loadPlaybook(name, projectRoot, locations = {}) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`Invalid playbook name '${name}'.`);
  const paths = [
    join2(projectRoot, "playbooks", `${name}.md`),
    join2(locations.globalRoot ?? join2(homedir(), ".edu"), "playbooks", `${name}.md`),
    join2(locations.templatesDir ?? packageTemplatesDir(), "playbooks", "default.md")
  ];
  for (const path of paths) {
    let markdown;
    try {
      markdown = await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const document = parseFrontmatter(markdown);
    if (!document) throw new Error(`Playbook '${path}' must begin with YAML frontmatter.`);
    const meta = FrontmatterSchema.parse(document.meta);
    if (path !== paths[2] && meta.name !== name) throw new Error(`Playbook '${path}' declares name '${meta.name}', expected '${name}'.`);
    return { ...meta, body: document.body, path };
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

// src/orchestrator/run/brief.ts
async function briefPhase(run) {
  const { deps, budget, goal } = run;
  if (deps.signal?.aborted) throw new Error("Run cancelled before start.");
  if (deps.config.routing?.advisor && budget.limits.maxAdvisorCalls > 0 && !deps.autoApprove && deps.config.approvals !== "auto") {
    const cli = assignCli("advisor", deps.config, deps.available);
    if (deps.engines(cli).capabilities?.readonly !== "enforced") throw new Error("Advisor requires enforced read-only execution.");
  }
  const playbook = await loadPlaybook(deps.playbookName ?? deps.config.playbook ?? "default", dirname2(deps.runsDir));
  run.harnessLevel = deps.harnessLevel ?? playbook.harness;
  run.methodSummary = workerMethod(playbook);
  run.config = withinCeiling(run, applyPlaybookRoles(deps.config, playbook));
  const contextual = run.harnessLevel === "H2" || run.harnessLevel === "H3";
  if (contextual) {
    run.pack = await deps.context.build({ query: goal, budgetTokens: deps.config.context.budgetTokens });
    for (const section of run.pack.sections) for (const noteId of section.noteIds) {
      if (run.pack.text.includes(`[[${noteId}]]`)) run.suppliedNotes.add(noteId);
      await emitEvidence(run, { type: "context.trace", noteId, contribution: section.title, influenced: false, at: at(run) });
    }
  }
  const session = await deps.brain.openSession(`Run: ${goal}`, "edu:orchestrator");
  run.sessionId = session.meta.id;
  await writeStatus(run, "running", "Run started; inspect event log before resuming interrupted work.");
  if (run.harnessLevel !== "H0") {
    const [tools, checks] = await Promise.all([loadTools(deps.cwd), loadChecks(deps.cwd)]);
    run.registeredChecks = checks;
    run.registryInfo = JSON.stringify({ tools, checks }, null, 2);
  }
  if (contextual) {
    run.taskStatePath = join3(deps.runsDir, run.runId, "task-state.md");
    await mkdir2(dirname2(run.taskStatePath), { recursive: true });
    await saveTaskState(run, taskStateMarkdown(goal, "- Planner is preparing the task plan."));
  }
  return playbook;
}
function withinCeiling(run, config) {
  const ceiling = run.deps.maxAutonomy;
  if (!ceiling) return config;
  const capped = capRoleAutonomy(config, ceiling);
  for (const role of capped.lowered) run.limitations.push(`Role ${role.id} asked for ${role.requested} autonomy, above the crew ceiling "${ceiling}", so it ran with "${ceiling}". A person can raise crew.maxAutonomy in the global Edu config.`);
  return capped.config;
}

// src/orchestrator/run/agents.ts
import { randomUUID as randomUUID3 } from "crypto";
import { z as z2 } from "zod";
var ApplicationSchema = z2.object({ noteId: z2.string().min(1), requirementIds: z2.array(z2.string().min(1)).min(1), application: z2.string().min(1) }).strict();
async function runAgent(run, call) {
  const { cli, agentId, role: roleId, prompt, autonomy, context, method = "", signal = run.deps.signal } = call;
  const role = run.config.roles.find((candidate) => candidate.id === roleId);
  const model = roleRoute(roleId, run.config)?.model ?? role?.model;
  await emit(run, { type: "agent.spawn", agentId, role: roleId, cli, task: prompt.slice(0, 160), at: at(run) });
  await emit(run, { type: "agent.status", agentId, status: "running", at: at(run) });
  const purpose = agentId.includes("fix") || agentId.endsWith("-repair") || prompt.includes("Invalid plan") || prompt.startsWith("Your previous") ? "recovery" : roleId === "lead" ? "planning" : roleId === "reviewer" ? "review" : "task";
  const requireReadonly = autonomy === "readonly" && (roleId === "lead" || roleId === "reviewer" || roleId === "advisor");
  const request = { invocation: { id: randomUUID3(), purpose }, cli, prompt: `${prompt}

Context pack:
${context}`, cwd: run.deps.cwd, autonomy, ...requireReadonly ? { requireReadonly } : {}, systemPrompt: [role?.mission, roleId === "lead" ? "" : method, roleId === "builder" && context.includes("Brain context pack:") ? 'If you actually apply a supplied note, cite it explicitly on a separate line: EDU_APPLIED {"noteId":"L-id","requirementIds":["R-1"],"application":"Applied [[L-id]] by ..."}. Report only concrete application, never mere exposure or presumed benefit.' : ""].filter(Boolean).join("\n\n"), ...model ? { model } : {}, signal };
  let text = "";
  let summary = "";
  let sessionId;
  try {
    for await (const event of measuredEngine(run.deps.engines(cli)).run(request, agentId)) {
      const stamped = { ...event, at: event.at || at(run) };
      if (stamped.type === "agent.text") text += stamped.text;
      if (stamped.type === "agent.end") {
        summary = stamped.summary;
        sessionId = stamped.sessionId;
      }
      await emit(run, stamped);
      if (signal?.aborted) throw new Error("Run cancelled.");
      if (stamped.type === "error") throw new Error(`Engine reported an error: ${stamped.message}`);
      if (stamped.type === "agent.end" && !stamped.ok) throw new Error(`Engine run failed: ${stamped.summary}`);
    }
    if (signal?.aborted) throw new Error("Run cancelled.");
    return { text, summary, ...sessionId ? { sessionId } : {} };
  } catch (error) {
    await emit(run, { type: "agent.status", agentId, status: signal?.aborted ? "cancelled" : "failed", at: at(run) });
    throw error;
  }
}
function readonlyCli(run, role) {
  const { deps, config } = run;
  const assigned = assignCli(role, config, deps.available);
  const enforced = (cli) => deps.engines(cli).capabilities?.readonly === "enforced";
  if (enforced(assigned)) return assigned;
  const builderCli = role === "reviewer" ? assignCli("builder", config, deps.available) : void 0;
  const candidates = deps.available.filter(enforced).sort((a, b) => Number(a === builderCli) - Number(b === builderCli));
  const fallback = candidates[0];
  if (!fallback) throw new Error(`The ${role} must run read-only, but ${assigned} cannot enforce it and no installed CLI can. Install claude, codex or pi, or route the ${role} to one of them.`);
  run.limitations.push(`${role}: ${assigned} cannot enforce read-only, so the ${role} ran on ${fallback}.`);
  return fallback;
}
function builderPrompt(task, goal, priorEvidence, level) {
  const workflow = level === "H3" ? "Use the H3 workflow: reproduce \u2192 attribute \u2192 fix \u2192 verify \u2192 report. Edu runs deterministic checks; if verification disproves the diagnosis, use the back-edge to attribution before the bounded correction." : "";
  return [task, `Goal:
${goal}`, priorEvidence ? `Prior reproduction evidence:
${priorEvidence}` : "", workflow].filter(Boolean).join("\n\n");
}
async function recordApplications(run, text) {
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
    if (!run.suppliedNotes.has(entry.noteId) || !entry.application.includes(`[[${entry.noteId}]]`) || !entry.requirementIds.every((id) => run.requirements.some((requirement) => requirement.id === id))) continue;
    const previous = run.applications.get(entry.noteId);
    run.applications.set(entry.noteId, { requirementIds: [.../* @__PURE__ */ new Set([...previous?.requirementIds ?? [], ...entry.requirementIds])], application: previous ? `${previous.application}
${entry.application}` : entry.application });
    if (!previous) await emitEvidence(run, { type: "context.trace", noteId: entry.noteId, contribution: entry.application, influenced: true, at: at(run) });
  }
}

// src/orchestrator/run/execute.ts
async function executePhase(run, plan) {
  const { deps, budget } = run;
  if (run.harnessLevel === "H3") run.workflowEvidence = await reproduceChecks(run, run.effectiveChecks);
  const completed = /* @__PURE__ */ new Map();
  const pending = new Map(plan.steps.map((step) => [step.id, step]));
  const enforcedReader = (step) => run.config.roles.find((role) => role.id === step.role)?.autonomy === "readonly" && deps.engines(assignCli(step.role, run.config, deps.available)).capabilities?.readonly === "enforced";
  while (pending.size) {
    if (deps.signal?.aborted) throw new Error("Run cancelled.");
    const ready = [...pending.values()].filter((step) => step.dependsOn.every((id) => completed.has(id)));
    if (!ready.length) throw new Error("Plan contains a dependency cycle or an unsatisfied dependency.");
    const first = ready[0];
    const firstReadonly = run.config.roles.find((role) => role.id === first.role)?.autonomy === "readonly" && enforcedReader(first);
    const batch = first.parallelSafe && firstReadonly ? ready.filter((step) => step.parallelSafe && enforcedReader(step)).slice(0, budget.limits.maxConcurrency) : [first];
    const batchController = new AbortController();
    const batchSignal = deps.signal ? AbortSignal.any([deps.signal, batchController.signal]) : batchController.signal;
    const settled = await Promise.allSettled(batch.map((step) => executeStep(run, step, batchSignal).catch((error) => {
      batchController.abort();
      throw error;
    })));
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      const outcome = result.value;
      pending.delete(outcome.id);
      run.steps.push(outcome);
      if (!outcome.ok) throw new Error(`Step '${outcome.id}' failed: ${outcome.summary}`);
      completed.set(outcome.id, outcome.summary);
      if (run.taskStatePath) await saveTaskState(run, `${run.taskState}
## Progress
- ${outcome.id}: ${outcome.ok ? "completed" : "failed"} \u2014 ${outcome.summary}
`);
    }
  }
  return completed;
}
async function executeStep(run, step, signal) {
  const { runId, goal, deps } = run;
  const role = run.config.roles.find((candidate) => candidate.id === step.role);
  const cli = assignCli(step.role, run.config, deps.available);
  const dependencyContext = step.dependsOn.map((id) => `${id}: ${run.steps.find((item) => item.id === id)?.summary ?? ""}`).join("\n");
  const prompt = step.role === "builder" ? `${builderPrompt(step.task, goal, run.workflowEvidence, run.harnessLevel)}

Dependencies:
${dependencyContext}` : `${step.task}

Goal: ${goal}

Dependencies:
${dependencyContext}`;
  const response = await runAgent(run, { cli, agentId: `${runId}-${step.id}`, role: step.role, prompt, autonomy: role?.autonomy ?? "readonly", context: supportContext(run), method: run.methodSummary, signal });
  if (step.role === "builder") await recordApplications(run, response.text);
  return { id: step.id, ok: true, summary: response.summary || response.text };
}

// src/orchestrator/run/learn.ts
import { dirname as dirname3 } from "path";

// src/evidence/entropy.ts
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
import { readFile as readFile2 } from "fs/promises";
import { join as join4 } from "path";
var exec2 = promisify2(execFile2);
async function auditGitDiff(cwd, startCommit, applicableRequirementIds = []) {
  const [{ stdout: diff }, { stdout: names }, { stdout: untracked }] = await Promise.all([
    exec2("git", ["diff", "--no-ext-diff", "--unified=0", startCommit, "--"], { cwd, maxBuffer: 16 * 1024 * 1024 }),
    exec2("git", ["diff", "--name-only", startCommit, "--"], { cwd }),
    exec2("git", ["ls-files", "--others", "--exclude-standard"], { cwd })
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
    baselineText = (await exec2("git", ["show", `${startCommit}:${path}`], { cwd })).stdout;
  } catch {
    return [];
  }
  const baseline = parseCheckSnapshots(baselineText);
  if (!baseline) return [];
  const applicableBaseline = baseline.filter((check) => check.requirementIds.some((id) => applicableRequirementIds.has(id)));
  if (!applicableBaseline.length) return [];
  let currentText;
  try {
    currentText = await readFile2(join4(cwd, path), "utf8");
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
  const docs = await exec2("git", ["ls-files", "*.md", "*.mdx", "*.rst"], { cwd }).then((result) => result.stdout.split(/\r?\n/).filter(Boolean));
  const findings = [];
  for (const source of sourceFiles) {
    const moduleName = source.split("/").pop()?.replace(/\.[^.]+$/, "");
    if (!moduleName) continue;
    for (const doc of docs) {
      if (changedDocs.has(doc)) continue;
      try {
        if ((await readFile2(join4(cwd, doc), "utf8")).includes(moduleName)) {
          findings.push({ category: "stale-docs", severity: 1, path: doc, detail: `Documentation mentions changed module "${moduleName}" but was not updated.` });
          break;
        }
      } catch {
      }
    }
  }
  return findings;
}

// src/evidence/package.ts
import { mkdir as mkdir3 } from "fs/promises";
import { join as join5 } from "path";
var types = (events, ...names) => events.filter((event) => names.includes(event.type));
var jsonl = (events) => events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}
` : "";
async function buildEpisodePackage(root, runId, events, options = {}) {
  const directory = join5(root, "runs", runId);
  await mkdir3(directory, { recursive: true });
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
  await Promise.all(Object.entries(content).map(([name, body]) => atomicWrite(join5(directory, name), body)));
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

// src/orchestrator/run/learn.ts
var UNSAFE = ["weakened-tests", "checks-bypassed", "unsafe-invalid"];
async function learnPhase(run, success) {
  const { runId, deps, requirements, limitations } = run;
  clearTimeout(run.timer);
  await persistStatus(run, false, "Finalization pending; consult the event log if interrupted.");
  await run.composer.close();
  const entropyUnsafe = await auditEntropy(run);
  const latestChecks = /* @__PURE__ */ new Map();
  for (const event of run.evidenceEvents) if (event.type === "verify.result" && event.kind === "deterministic" && event.checkId) latestChecks.set(event.checkId, event);
  const passed = (checkId) => Boolean(latestChecks.get(checkId)?.ok && !latestChecks.get(checkId)?.timedOut);
  const verifiedRequirements = requirements.filter((requirement) => {
    const checks = run.effectiveChecks.filter((check) => check.requirementIds.includes(requirement.id));
    return checks.length > 0 && checks.every((check) => passed(check.id));
  }).map((requirement) => requirement.id);
  const verified = requirements.length > 0 && verifiedRequirements.length === requirements.length;
  success &&= [...latestChecks.values()].every((result) => result.ok && !result.timedOut);
  const hasIntervention = run.evidenceEvents.some((event) => event.type === "intervention" || event.type === "approval.resolve" && isHuman(event.by));
  let label = entropyUnsafe ? "unsafe_invalid" : !success ? "failed" : !verified ? "unverified_success" : hasIntervention ? "assisted_verified_success" : "autonomous_verified_success";
  const outcome = { type: "outcome", label, metrics: { harnessLevel: run.harnessLevel, cli: run.config.defaultCli, role: "builder", verifiedRequirements, entropySeverity: run.evidenceEvents.filter((event) => event.type === "entropy.finding").reduce((severity, event) => Math.max(severity, event.severity), 0), elapsedMs: Date.parse(at(run)) - Date.parse(run.events[0]?.at ?? at(run)) }, at: at(run) };
  const end = { type: "run.end", runId, ok: success, summary: run.summary, at: at(run) };
  const episodeDir = await buildEpisodePackage(dirname3(deps.runsDir), runId, [...run.events, outcome, end], { limitations: [...limitations, ...success ? [] : [run.summary]] });
  const classification = await diagnosePackage(episodeDir);
  outcome.label = label = classification.label;
  if (label === "failed" && success) {
    success = false;
    end.ok = false;
    end.summary = run.summary = `Episode verification failed: ${classification.reasons.join("; ")}`;
  }
  await emitEvidence(run, outcome);
  if (success && label !== "unsafe_invalid" && !deps.signal?.aborted) await creditApplications(run, label, passed);
  await emit(run, end);
  await buildEpisodePackage(dirname3(deps.runsDir), runId, run.events, { limitations: [...limitations, ...success ? [] : [run.summary]] });
  await persistStatus(run, success, run.summary);
  await autoMaintain(deps.brain, dirname3(deps.runsDir), { now: deps.now?.() ?? /* @__PURE__ */ new Date() }).catch(() => void 0);
  return { runId, ok: success, summary: run.summary, events: run.events, steps: run.steps, episodeDir };
}
async function auditEntropy(run) {
  let unsafe = false;
  if (run.startCommit) {
    try {
      const audit = await auditGitDiff(run.deps.cwd, run.startCommit, run.requirements.map((requirement) => requirement.id));
      unsafe = audit.findings.some((finding) => UNSAFE.includes(finding.category));
      for (const finding of audit.findings) await emitEvidence(run, { type: "entropy.finding", ...finding, at: at(run) });
    } catch (error) {
      run.limitations.push(`Git diff entropy audit unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    run.limitations.push("Git start commit unavailable; entropy audit was not run.");
  }
  return unsafe || run.events.some((event) => event.type === "entropy.finding" && UNSAFE.includes(event.category));
}
async function creditApplications(run, label, passed) {
  for (const [noteId, application] of run.applications) {
    const relevant = run.effectiveChecks.filter((check) => check.requirementIds.some((id) => application.requirementIds.includes(id)));
    const covered = application.requirementIds.every((id) => relevant.some((check) => check.requirementIds.includes(id)));
    if (!covered || !relevant.length || !relevant.every((check) => passed(check.id))) continue;
    const feedback = {
      // The persistent ledger is per note; keep its event key bounded regardless of note ID length.
      eventId: `${run.runId}:${label}`,
      verified: true,
      evidence: [`application:${application.application}`, ...relevant.map((check) => `deterministic-check:${check.id}`)]
    };
    try {
      await run.deps.brain.feedback(noteId, true, feedback);
    } catch (error) {
      run.limitations.push(`Feedback for ${noteId} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// src/orchestrator/run/plan.ts
import { dirname as dirname4 } from "path";

// src/orchestrator/plan.ts
import { z as z3 } from "zod";
var RequirementSchema = z3.object({ id: z3.string().min(1), text: z3.string().min(1) }).strict();
var PlanSchema = z3.object({
  requirements: z3.array(RequirementSchema).default([]),
  checks: z3.array(CheckSchema).default([]),
  steps: z3.array(z3.object({
    id: z3.string().min(1),
    role: z3.string().min(1),
    task: z3.string().min(1),
    dependsOn: z3.array(z3.string()),
    parallelSafe: z3.boolean()
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

// src/orchestrator/spec.ts
import { join as join6 } from "path";
async function writeSpec(root, goal, playbookName, harness, plan, config, available, now, runId) {
  const stamp = `${now.toISOString().slice(0, 10).replaceAll("-", "")}-${now.toISOString().slice(11, 16).replace(":", "")}`;
  const path = join6(root, "specs", `${stamp}-${slugify(goal) || "run"}-${runId.slice(0, 8)}.md`);
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

// src/orchestrator/run/plan.ts
async function planPhase(run, playbook) {
  const { runId, goal, deps } = run;
  const leadId = `${runId}-lead`;
  for (const role of run.config.roles) {
    const cli = assignCli(role.id, run.config, deps.available);
    const capabilities = deps.engines(cli).capabilities;
    if (role.autonomy === "readonly" && capabilities.readonly !== "enforced") run.limitations.push(`${role.id}/${cli}: readonly enforcement unsupported; steps run serially. ${capabilities.limitations.join(" ")}`);
  }
  const leadCli = readonlyCli(run, "lead");
  const planningMethod = `Playbook: ${playbook.name}
${playbook.description}

${playbook.body}`;
  const lead = (agentId, prompt) => runAgent(run, { cli: leadCli, agentId, role: "lead", prompt, autonomy: "readonly", context: supportContext(run), method: run.methodSummary });
  const planText = await lead(leadId, planningPrompt(goal, "", { harnessLevel: run.harnessLevel, playbook: planningMethod }));
  let plan;
  try {
    plan = extractPlan(planText.text);
  } catch (first) {
    const repaired = await lead(`${leadId}-repair`, `${repairPrompt(planText.text, String(first))}

Follow this playbook method when planning:
${planningMethod}`);
    try {
      plan = extractPlan(repaired.text);
    } catch (second) {
      throw new Error(`Unable to produce a valid plan after one repair: ${String(second)}`);
    }
  }
  await emit(run, { type: "agent.end", agentId: leadId, ok: true, summary: `Planned ${plan.steps.length} step(s).`, ...planText.sessionId ? { sessionId: planText.sessionId } : {}, at: at(run) });
  run.requirements = plan.requirements;
  await emitEvidence(run, { type: "task.define", requirements: run.requirements, successCriteria: run.requirements.map((requirement) => requirement.text), at: at(run) });
  run.effectiveChecks = resolveChecks(plan.checks, run.registeredChecks);
  if (run.harnessLevel === "H3") await reportBypassedChecks(run);
  await saveTaskState(run, taskStateMarkdown(goal, plan.steps.map((step) => `- ${step.id}: ${step.task}`).join("\n") || "- Report the task outcome."));
  for (const step of plan.steps) {
    if (step.role !== "explorer" && step.role !== "builder" && step.role !== "reviewer") throw new Error(`Unsupported plan role '${step.role}' in step '${step.id}'.`);
  }
  const spec = await writeSpec(dirname4(deps.runsDir), goal, playbook.name, run.harnessLevel, plan, run.config, deps.available, deps.now?.() ?? /* @__PURE__ */ new Date(), runId);
  await emit(run, { type: "spec.ready", path: spec.path, requirements: run.requirements, checks: plan.checks, steps: plan.steps.map((step) => ({ id: step.id, role: step.role, cli: assignCli(step.role, run.config, deps.available), task: step.task })), at: at(run) });
  return { plan, spec };
}
async function reportBypassedChecks(run) {
  const requirementIds = new Set(run.requirements.map((requirement) => requirement.id));
  const selectedIds = new Set(run.effectiveChecks.map((check) => check.id));
  for (const check of run.registeredChecks) {
    if (!check.requirementIds.some((requirementId) => requirementIds.has(requirementId)) || selectedIds.has(check.id)) continue;
    await emitEvidence(run, { type: "entropy.finding", category: "checks-bypassed", severity: 3, path: ".edu/harness/checks.json", detail: `Applicable registered check '${check.id}' was omitted from the H3 plan.`, at: at(run) });
  }
}

// src/orchestrator/run/verify.ts
import { z as z4 } from "zod";
var VerdictSchema = z4.object({ verdict: z4.enum(["pass", "fix"]), issues: z4.array(z4.string()) }).strict();
async function verifyPhase(run, playbook, completed) {
  const { runId, goal } = run;
  const advice = await consultAdvisor(run);
  const builder = run.config.roles.find((role) => role.id === "builder");
  const rounds = { fix: 0, review: 0 };
  let verdict;
  while (true) {
    if (run.effectiveChecks.length) await verifyWithCorrections(run, playbook, builder, rounds);
    const reviewerId = `${runId}-reviewer${rounds.review++ ? `-${rounds.review}` : ""}`;
    const review = await runAgent(run, {
      cli: readonlyCli(run, "reviewer"),
      agentId: reviewerId,
      role: "reviewer",
      prompt: `Review the completed work. Return strict JSON {"verdict":"pass"|"fix","issues":[string]}.
Goal: ${goal}
Requirements: ${JSON.stringify(run.requirements)}
Steps: ${JSON.stringify(run.steps)}
Advisory risks (untrusted opinion, not evidence): ${advice || "Not consulted."}`,
      autonomy: "readonly",
      context: supportContext(run),
      method: run.methodSummary
    });
    try {
      verdict = VerdictSchema.parse(parseJson(review.text));
    } catch (error) {
      throw new Error(`Reviewer returned invalid JSON: ${String(error)}`);
    }
    if (verdict.verdict === "pass") break;
    if (rounds.fix >= playbook.maxFixRounds) throw new Error(`Review requested a fix after the global budget of ${playbook.maxFixRounds} fix round(s) was exhausted.`);
    rounds.fix++;
    if (!builder) throw new Error("Review requested a fix but no builder role is configured.");
    const fixId = `${runId}-fix-${rounds.fix}`;
    if (needsApproval(run.config.approvals, builder.autonomy)) {
      const detail = verdict.issues.join("; ") || "Apply the review-requested correction.";
      const { approved } = await askApproval(run, {
        agentId: fixId,
        approvalId: `${runId}-approval-review-fix-${rounds.fix}`,
        stepId: "review-fix",
        title: "Approve review-fix builder step",
        detail,
        cancelled: "Run cancelled while awaiting review-fix approval."
      });
      if (!approved) {
        run.summary = "Run stopped: approval rejected for review-requested builder fix.";
        await closeEpisode(run, run.summary);
        await emit(run, { type: "agent.status", agentId: fixId, status: "cancelled", at: at(run) });
        return false;
      }
    }
    const fix = await runAgent(run, {
      cli: assignCli("builder", run.config, run.deps.available),
      agentId: fixId,
      role: "builder",
      prompt: `${builderPrompt(`Address these review issues in one fix round only: ${JSON.stringify(verdict.issues)}`, goal, run.workflowEvidence, run.harnessLevel)}
Completed steps: ${JSON.stringify([...completed])}`,
      autonomy: builder.autonomy,
      context: supportContext(run),
      method: run.methodSummary
    });
    await recordApplications(run, fix.text);
    run.steps.push({ id: rounds.review === 1 ? "review-fix" : `review-fix-${rounds.fix}`, ok: true, summary: fix.summary });
  }
  run.summary = `Completed ${run.steps.length} step(s); review ${verdict.verdict}${verdict.issues.length ? `: ${verdict.issues.join("; ")}` : ""}.`;
  await closeEpisode(run, run.summary);
  return true;
}
async function verifyWithCorrections(run, playbook, builder, rounds) {
  const { runId, goal } = run;
  let results = await verifyChecks(run, run.effectiveChecks);
  while (results.some((result) => !result.ok) && builder && rounds.fix < playbook.maxFixRounds) {
    const round = ++rounds.fix;
    const details = results.filter((result) => !result.ok).map((result) => {
      const check = run.effectiveChecks.find((candidate) => candidate.id === result.checkId);
      return `${check.id}: observed exit=${result.exitCode}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}, timeout=${result.timedOut}; expected exit=${check.expect.exitCode ?? 0}${check.expect.stdoutIncludes === void 0 ? "" : `, stdout includes ${JSON.stringify(check.expect.stdoutIncludes)}`}`;
    }).join("\n");
    const agentId = `${runId}-verification-fix-${round}`;
    if (needsApproval(run.config.approvals, builder.autonomy)) {
      const detail = `A deterministic check failed; authorize bounded builder correction ${round}/${playbook.maxFixRounds}.
${details}`;
      const { approved } = await askApproval(run, {
        agentId,
        approvalId: `${runId}-approval-verification-fix-${round}`,
        stepId: `verification-fix-${round}`,
        title: "Approve deterministic-verification correction",
        detail,
        cancelled: "Run cancelled while awaiting verification correction approval."
      });
      if (!approved) throw new Error("Run stopped: deterministic-verification correction was rejected.");
    }
    const fix = await runAgent(run, {
      cli: assignCli("builder", run.config, run.deps.available),
      agentId,
      role: "builder",
      prompt: `${builderPrompt("Correct the failed deterministic verification.", goal, `Observed vs expected:
${details}`, run.harnessLevel)}
Reproduce, attribute, fix, verify, then report. If verification disproves attribution, return to attribution before changing code.`,
      autonomy: builder.autonomy,
      context: supportContext(run),
      method: run.methodSummary
    });
    await recordApplications(run, fix.text);
    run.steps.push({ id: `verification-fix-${round}`, ok: true, summary: fix.summary });
    results = await verifyChecks(run, run.effectiveChecks);
  }
  if (results.some((result) => !result.ok)) throw new Error(`Deterministic verification failed after ${playbook.maxFixRounds} fix round(s).`);
}
async function consultAdvisor(run) {
  const { runId, goal, deps, budget } = run;
  if (!run.config.routing?.advisor || budget.limits.maxAdvisorCalls <= 0) return "";
  if (deps.autoApprove || run.config.approvals === "auto") {
    run.limitations.push("Advisor skipped: consultation requires an explicit human disclosure approval.");
    return "";
  }
  const advisorCli = assignCli("advisor", run.config, deps.available);
  if (deps.engines(advisorCli).capabilities?.readonly !== "enforced") throw new Error("Advisor requires enforced read-only execution.");
  const agentId = `${runId}-advisor`;
  const title = "Approve advisor disclosure";
  const detail = `Consult ${advisorCli} with the goal and requirement IDs only. This CLI may inspect the workspace read-only; this is not a tool-free advisor. Usage may be unavailable. No automatic follow-up consultations. The existing local run event log and episode package retain raw output (unlike sanitized Crew artifacts); workspace secrets could appear there. Do not approve for sensitive workspaces.`;
  const approvalId = `${runId}-approval-advisor`;
  await emit(run, { type: "approval.request", agentId, approvalId, title, detail, at: at(run) });
  const answer = answerOf(await awaitApproval(deps.approve({ agentId, stepId: "advisor", title, detail }), deps.signal), "user");
  await emit(run, { type: "approval.resolve", approvalId, approved: answer.approved, by: answer.by, at: at(run) });
  if (answer.approved && !isHuman(answer.by)) run.limitations.push(`Advisor skipped: the disclosure was approved by ${answer.by}, not a person.`);
  if (!answer.approved || !isHuman(answer.by)) return "";
  budget.advisorCalls++;
  const advice = await runAgent(run, {
    cli: advisorCli,
    agentId,
    role: "advisor",
    prompt: `Give one bounded second opinion on risks and verification. Do not delegate, modify files, or write memory. Goal: ${goal}
Requirement IDs: ${run.requirements.map((r) => r.id).join(", ")}`,
    autonomy: "readonly",
    context: "",
    method: ""
  });
  run.limitations.push(`Advisor consultation recorded in ${runId}.jsonl; advisory only (${advice.text.length} characters). Independent review remains mandatory.`);
  return advice.text.slice(0, 4e3) + (advice.text.length > 4e3 ? "\n[Advisor output truncated; full consultation is in the run event log.]" : "");
}
function parseJson(value) {
  const match = value.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  try {
    return JSON.parse(match?.[1]?.trim() ?? value.trim());
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// src/orchestrator/run.ts
async function orchestrate(goal, deps) {
  const run = await startRun(goal, deps);
  try {
    const playbook = await briefPhase(run);
    const planned = await planPhase(run, playbook);
    if (!await approvePhase(run, playbook, planned)) return await learnPhase(run, false);
    const completed = await executePhase(run, planned.plan);
    return await learnPhase(run, await verifyPhase(run, playbook, completed));
  } catch (error) {
    return await fail(run, error);
  }
}
async function fail(run, error) {
  run.terminalStatus = error instanceof BudgetExhausted || run.deadline.aborted ? "budget_exhausted" : run.deps.signal?.aborted ? "cancelled" : "blocked";
  run.summary = run.deadline.aborted ? "Execution budget exhausted: timeoutMs." : error instanceof Error ? error.message : String(error);
  if (run.sessionId) await closeEpisode(run, run.summary).catch(() => {
  });
  await emit(run, { type: "error", message: run.summary, at: at(run) });
  return learnPhase(run, false);
}
export {
  orchestrate
};
//# sourceMappingURL=run-QXPYF5RY.js.map