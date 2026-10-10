// src/tui/demo.ts
var T0 = Date.parse("2026-10-08T12:00:00.000Z");
var LEAD = "lead-1";
function demoEvents() {
  const events = [];
  let t = 0;
  const push = (gap, event) => {
    t += gap;
    events.push({ ...event, at: new Date(T0 + t).toISOString() });
  };
  const spawn = (gap, agentId, role, cli, task) => {
    push(gap, { type: "agent.spawn", agentId, parentId: LEAD, role, cli, task });
  };
  const status = (gap, agentId, s) => push(gap, { type: "agent.status", agentId, status: s });
  let call = 0;
  const tool = (gap, agentId, name, input, output, ok = true) => {
    const callId = `call-${++call}`;
    push(gap, { type: "tool.call", agentId, callId, tool: name, input });
    push(320, { type: "tool.result", agentId, callId, ok, output });
  };
  const usage = (gap, agentId, inputTokens, outputTokens, costUsd) => push(gap, { type: "usage", agentId, usage: { inputTokens, outputTokens, costUsd } });
  const context = (gap, usedTokens) => push(gap, { type: "context.usage", agentId: LEAD, usedTokens, windowTokens: 1e6 });
  push(0, { type: "run.start", runId: "demo-001", goal: "Add OAuth login with a reviewed callback route", mode: "crew" });
  push(0, { type: "agent.spawn", agentId: LEAD, role: "lead", cli: "claude", model: "demo-model", task: "Plan, delegate and verify the OAuth change" });
  status(100, LEAD, "running");
  push(300, { type: "brain.recall", agentId: LEAD, noteIds: ["D-keep-adapters-small", "L-validate-oauth-state", "C-ship-login"] });
  context(200, 182e3);
  push(500, { type: "agent.text", agentId: LEAD, text: "Two explorers map the flow and the tests; two builders split route and guard; a different vendor reviews." });
  push(700, {
    type: "spec.ready",
    path: ".edu/specs/oauth-login.md",
    requirements: [
      { id: "R1", text: "Callback exchanges the code for a session" },
      { id: "R2", text: "Requests with a bad state are rejected" },
      { id: "R3", text: "Existing sessions keep working" }
    ],
    checks: [
      { id: "unit-auth", requirementIds: ["R1"], command: "npm test -- auth", expect: { exitCode: 0 }, timeoutMs: 6e4 },
      { id: "state-guard", requirementIds: ["R2"], command: "npm test -- state", expect: { exitCode: 0 }, timeoutMs: 6e4 },
      { id: "regression", requirementIds: ["R3"], command: "npm test", expect: { exitCode: 0 }, timeoutMs: 12e4 }
    ],
    steps: [
      { id: "s1", role: "explorer", cli: "codex", task: "Map the auth call path" },
      { id: "s2", role: "explorer", cli: "claude", task: "Find the session tests" },
      { id: "s3", role: "builder", cli: "claude", task: "Implement the callback route" },
      { id: "s4", role: "builder", cli: "pi", task: "Add the state guard" },
      { id: "s5", role: "reviewer", cli: "opencode", task: "Review the diff" }
    ]
  });
  push(400, { type: "approval.request", agentId: LEAD, approvalId: "approve-spec", title: "Approve the spec: 3 requirements, 3 checks", detail: "R1 callback exchanges the code\nR2 bad state is rejected\nR3 existing sessions keep working" });
  status(0, LEAD, "awaiting-approval");
  push(2200, { type: "approval.resolve", approvalId: "approve-spec", approved: true, by: "user" });
  status(0, LEAD, "running");
  spawn(300, "explorer-1", "explorer", "codex", "Map the auth call path");
  spawn(150, "explorer-2", "explorer", "claude", "Find the session tests");
  status(100, "explorer-1", "running");
  status(100, "explorer-2", "running");
  tool(300, "explorer-1", "grep", "passport|oauth src/", "7 matches in 3 files");
  tool(250, "explorer-2", "glob", "test/**/session*.ts", "4 files");
  tool(400, "explorer-1", "read_file", "src/auth/index.ts", "Read 128 lines");
  push(300, { type: "agent.text", agentId: "explorer-2", text: "Session tests stub the token store; reuse that fixture." });
  usage(200, "explorer-1", 21e3, 1900, 0.11);
  tool(300, "explorer-1", "read_file", "src/routes/index.ts", "Read 64 lines");
  usage(200, "explorer-2", 12500, 900, 0.06);
  push(300, { type: "agent.end", agentId: "explorer-2", ok: true, summary: "Found 4 session tests and a reusable fixture." });
  push(500, { type: "agent.text", agentId: "explorer-1", text: "The callback mounts in routes/index.ts; state is never checked." });
  push(300, { type: "agent.end", agentId: "explorer-1", ok: true, summary: "Mapped the flow: login \u2192 provider \u2192 callback." });
  context(200, 341e3);
  spawn(400, "builder-1", "builder", "claude", "Implement the callback route");
  spawn(150, "builder-2", "builder", "pi", "Add the state guard");
  spawn(150, "reviewer-1", "reviewer", "opencode", "Review the diff");
  status(100, "builder-1", "running");
  status(100, "builder-2", "running");
  push(200, { type: "agent.thinking", agentId: "builder-1", text: "Exchange first, then persist the session." });
  tool(300, "builder-1", "read_file", "src/auth/index.ts", "Read 128 lines");
  tool(250, "builder-2", "edit", "src/auth/state.ts", "state.ts: +18 -2", false);
  push(200, { type: "error", agentId: "builder-2", message: "edit failed: stale file hash, retrying" });
  tool(400, "builder-2", "read_file", "src/auth/state.ts", "Read 40 lines");
  tool(300, "builder-2", "edit", "src/auth/state.ts", "state.ts: +18 -2");
  tool(300, "builder-1", "edit", "src/routes/callback.ts", "callback.ts: +42");
  usage(200, "builder-1", 38e3, 4200, 0.31);
  push(300, { type: "approval.request", agentId: "builder-1", approvalId: "write-files", title: "builder-1 wants to write 3 files", detail: "src/routes/callback.ts\nsrc/auth/index.ts\ntest/auth.test.ts" });
  status(0, "builder-1", "awaiting-approval");
  usage(400, "builder-2", 16e3, 2100, 0.04);
  push(2e3, { type: "approval.resolve", approvalId: "write-files", approved: true, by: "user" });
  status(0, "builder-1", "running");
  tool(300, "builder-1", "write_file", "test/auth.test.ts", "Wrote 3 files");
  context(200, 512e3);
  tool(300, "builder-2", "bash", "npm test -- state", "6 passed");
  push(300, { type: "agent.end", agentId: "builder-2", ok: true, summary: "State guard rejects mismatched state." });
  tool(300, "builder-1", "bash", "npm test -- auth", "12 passed");
  push(300, { type: "agent.end", agentId: "builder-1", ok: true, summary: "Callback route implemented and tested." });
  status(300, "reviewer-1", "running");
  tool(300, "reviewer-1", "git_diff", "HEAD", "4 files changed, +96 -4");
  push(400, { type: "agent.thinking", agentId: "reviewer-1", text: "Check the error path when the provider times out." });
  tool(400, "reviewer-1", "read_file", "src/routes/callback.ts", "Read 42 lines");
  usage(200, "reviewer-1", 24e3, 1600, 0.09);
  push(300, { type: "agent.end", agentId: "reviewer-1", ok: true, summary: "Approve: one nit on the timeout message." });
  push(300, { type: "verify.result", checkId: "unit-auth", requirementIds: ["R1"], ok: true, output: "12 passed", kind: "deterministic" });
  push(400, { type: "verify.result", checkId: "state-guard", requirementIds: ["R2"], ok: true, output: "6 passed", kind: "deterministic" });
  push(600, { type: "verify.result", checkId: "regression", requirementIds: ["R3"], ok: true, output: "214 passed", kind: "regression" });
  context(200, 663e3);
  push(300, { type: "brain.learn", noteId: "L-check-oauth-state-first", kind: "lesson", title: "Validate OAuth state before the token exchange" });
  usage(200, LEAD, 46e3, 3800, 0.42);
  push(300, { type: "agent.end", agentId: LEAD, ok: true, summary: "Plan and delegation complete." });
  push(200, { type: "outcome", label: "autonomous_verified_success", metrics: { checks: 3, passed: 3 } });
  push(200, { type: "run.end", runId: "demo-001", ok: true, summary: "Demo crew completed successfully." });
  return events;
}

export {
  demoEvents
};
//# sourceMappingURL=chunk-KFTON6RY.js.map