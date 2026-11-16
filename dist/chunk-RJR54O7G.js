import {
  measuredEngine
} from "./chunk-3U3ZYT3I.js";
import {
  atomicWrite
} from "./chunk-YINGR2DA.js";
import {
  HUMAN_APPROVERS
} from "./chunk-VP6QM6H5.js";

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
async function waitForAnswer(run, approval) {
  run.clock.pause();
  try {
    return await awaitApproval(approval(), run.deps.signal);
  } finally {
    run.clock.resume();
  }
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
    answer = answerOf(await waitForAnswer(run, () => deps.approve({ agentId, stepId, title, detail })), answer.by);
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
function budgetClock(ms, expire) {
  let remaining = ms;
  let since = Date.now();
  let paused = 0;
  let done = false;
  const arm = () => {
    const timer2 = setTimeout(() => {
      done = true;
      expire();
    }, Math.max(0, remaining));
    timer2.unref();
    return timer2;
  };
  let timer = arm();
  return {
    pause() {
      if (done || paused++ > 0) return;
      clearTimeout(timer);
      remaining -= Date.now() - since;
    },
    resume() {
      if (done || paused === 0 || --paused > 0) return;
      since = Date.now();
      timer = arm();
    },
    clear() {
      done = true;
      clearTimeout(timer);
      timer = void 0;
    }
  };
}
async function startRun(goal, input) {
  const runId = randomUUID();
  const budget = new RunBudget(input.config);
  const deadline = new AbortController();
  const clock = budgetClock(budget.limits.timeoutMs, () => deadline.abort(new BudgetExhausted("Execution budget exhausted: timeoutMs.")));
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
    clock,
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

export {
  BudgetExhausted,
  needsApproval,
  isHuman,
  answerOf,
  waitForAnswer,
  askApproval,
  budgetClock,
  startRun,
  at,
  emit,
  emitEvidence,
  writeStatus,
  persistStatus,
  closeEpisode,
  taskStateMarkdown,
  saveTaskState,
  supportContext
};
//# sourceMappingURL=chunk-RJR54O7G.js.map