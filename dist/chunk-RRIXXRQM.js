// src/tui/replay.ts
import { readFile } from "fs/promises";
var REQUIRED = {
  "run.start": { runId: "string", goal: "string", mode: "string" },
  "run.end": { runId: "string", ok: "boolean", summary: "string" },
  "agent.spawn": { agentId: "string", role: "string", cli: "string", task: "string" },
  "agent.status": { agentId: "string", status: "string" },
  "agent.text": { agentId: "string", text: "string" },
  "agent.thinking": { agentId: "string", text: "string" },
  "tool.call": { agentId: "string", callId: "string", tool: "string", input: "string" },
  "tool.result": { agentId: "string", callId: "string", ok: "boolean", output: "string" },
  usage: { agentId: "string", usage: "object" },
  "context.usage": { usedTokens: "number", windowTokens: "number" },
  "approval.request": { agentId: "string", approvalId: "string", title: "string", detail: "string" },
  "approval.resolve": { approvalId: "string", approved: "boolean", by: "string" },
  "brain.recall": { noteIds: "array" },
  "brain.learn": { noteId: "string", kind: "string", title: "string" },
  "agent.end": { agentId: "string", ok: "boolean", summary: "string" },
  error: { message: "string" },
  "task.define": { requirements: "array" },
  "context.trace": { noteId: "string", contribution: "string", influenced: "boolean" },
  "verify.result": { requirementIds: "array", ok: "boolean", output: "string", kind: "string" },
  "failure.attribution": { observed: "string", expected: "string", failureType: "string", evidence: "array", alternatives: "array", next: "string" },
  intervention: { by: "string", action: "string", avoidable: "boolean", harnessGap: "string" },
  "entropy.finding": { category: "string", severity: "number", path: "string", detail: "string" },
  outcome: { label: "string", metrics: "object" }
};
function eventProblem(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not an object";
  const v = value;
  if (typeof v.type !== "string" || !Object.hasOwn(REQUIRED, v.type)) return `unknown event type ${JSON.stringify(v.type)}`;
  if (typeof v.at !== "string" || Number.isNaN(Date.parse(v.at))) return `${v.type}: missing or invalid "at"`;
  const fields = REQUIRED[v.type];
  if (!fields) return `unknown event type ${JSON.stringify(v.type)}`;
  for (const [field, kind] of Object.entries(fields)) {
    const f = v[field];
    const ok = kind === "array" ? Array.isArray(f) : kind === "object" ? typeof f === "object" && f !== null : typeof f === kind;
    if (!ok) return `${v.type}: field "${field}" must be ${kind}`;
  }
  const validFailures = ["context", "tool", "feedback", "verify", "recovery", "entropy", "model", "unknown"];
  const validLabels = ["autonomous_verified_success", "assisted_verified_success", "unverified_success", "failed", "unsafe_invalid"];
  if (v.type === "task.define" && !v.requirements.every((item) => item && typeof item === "object" && typeof item.id === "string" && typeof item.text === "string")) return "task.define: requirements must contain id and text strings";
  if (v.type === "verify.result") {
    if (typeof v.checkId !== "string" && typeof v.method !== "string") return "verify.result: checkId or method is required";
    if (!["reproduction", "deterministic", "targeted-test", "regression", "lint", "review"].includes(String(v.kind))) return "verify.result: invalid kind";
  }
  if (v.type === "failure.attribution" && !validFailures.includes(String(v.failureType))) return "failure.attribution: invalid failureType";
  if (v.type === "intervention" && (v.by !== "user" || !validFailures.includes(String(v.harnessGap)))) return "intervention: invalid by or harnessGap";
  if (v.type === "entropy.finding" && ![0, 1, 2, 3].includes(Number(v.severity))) return "entropy.finding: severity must be 0, 1, 2, or 3";
  if (v.type === "outcome" && !validLabels.includes(String(v.label))) return "outcome: invalid label";
  return void 0;
}
function isEduEvent(value) {
  return eventProblem(value) === void 0;
}
function parseRunJsonl(text) {
  const events = [];
  const issues = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      issues.push({ line: i + 1, message: "invalid JSON" });
      return;
    }
    const problem = eventProblem(value);
    if (problem) issues.push({ line: i + 1, message: problem });
    else events.push(value);
  });
  return { events, issues };
}
async function loadRun(path) {
  return parseRunJsonl(await readFile(path, "utf8"));
}
async function* timedEvents(events, opts = {}) {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const sleep = opts.sleep ?? defaultSleep;
  let prev;
  for (const event of events) {
    if (opts.signal?.aborted) return;
    const t = Date.parse(event.at);
    if (prev !== void 0 && !Number.isNaN(t)) {
      let wait = Math.max(0, (t - prev) / speed);
      if (opts.maxDelayMs !== void 0) wait = Math.min(wait, opts.maxDelayMs);
      if (wait > 0) await sleep(wait, opts.signal);
      if (opts.signal?.aborted) return;
    }
    if (!Number.isNaN(t)) prev = t;
    yield event;
  }
}
function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export {
  eventProblem,
  isEduEvent,
  parseRunJsonl,
  loadRun,
  timedEvents
};
//# sourceMappingURL=chunk-RRIXXRQM.js.map