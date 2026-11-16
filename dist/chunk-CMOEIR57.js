import {
  createCrewStore,
  redactWorkerOutput
} from "./chunk-QKYNQ2TE.js";
import {
  DEFAULT_CREW_TIMEOUT_MINUTES,
  isTerminalCrewJobStatus
} from "./chunk-X4DEIY6R.js";
import {
  budgetClock
} from "./chunk-RJR54O7G.js";
import {
  runSession
} from "./chunk-753L45FB.js";
import {
  createEngine,
  detectEngines,
  enforcesReadonly,
  interactiveAutonomyFlags
} from "./chunk-XEODSS5O.js";
import {
  measuredEngine
} from "./chunk-3U3ZYT3I.js";
import {
  describeProcess,
  killTree,
  processAlive
} from "./chunk-CAQVQMTA.js";
import {
  sumUsage
} from "./chunk-6GXTQRCF.js";
import {
  childEnv
} from "./chunk-LVU7A3FM.js";
import {
  binaryOnPath
} from "./chunk-KLV4TDB7.js";
import {
  openBrain
} from "./chunk-BDQUVGCN.js";
import {
  brief
} from "./chunk-2KR4L72V.js";
import {
  truncateToTokens
} from "./chunk-ICQNXX6J.js";
import {
  CREW_POLICY_ENV,
  DEFAULT_CREW_POLICY,
  encodeWorkerPolicy,
  loadCrewPolicy,
  withinAutonomy
} from "./chunk-NYX2D5YD.js";
import {
  CLI_IDS
} from "./chunk-VP6QM6H5.js";

// src/crew/index.ts
import { execFile as execFileCallback2 } from "child_process";
import { promisify as promisify2 } from "util";
import { readFile, realpath } from "fs/promises";
import { basename, dirname, isAbsolute, join as join2, relative, resolve as resolve2, sep } from "path";

// src/crew/headless.ts
import { createHash } from "crypto";
import { open, mkdir } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join, resolve } from "path";
import { spawn } from "child_process";

// src/crew/orchestration.ts
import { homedir } from "os";
async function runOrchestration(job, options) {
  const { store } = options;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve3) => setTimeout(resolve3, ms)));
  const minutes = job.timeoutMinutes ?? DEFAULT_CREW_TIMEOUT_MINUTES;
  const limitMs = minutes * 6e4;
  const stop = new AbortController();
  let stopped;
  const halt = (reason) => {
    if (stopped === void 0) {
      stopped = reason;
      stop.abort(new Error(reason));
    }
  };
  const work = budgetClock(limitMs, () => halt(`Timed out after ${minutes} minute(s) of work; the run was stopped.`));
  const latestChecks = /* @__PURE__ */ new Map();
  let pendingSpec;
  const specPatch = () => {
    const patch = pendingSpec ? { specPath: pendingSpec, note: pendingSpec } : {};
    pendingSpec = void 0;
    return patch;
  };
  const flushSpec = async () => {
    if (pendingSpec) await store.update(job.id, specPatch());
  };
  const onEvent = async (event) => {
    await store.appendEvent(job.id, event);
    if (event.type === "spec.ready") {
      await flushSpec();
      pendingSpec = event.path;
      return;
    }
    if (event.type === "approval.request" && !job.autoApprove) {
      await store.openApproval(job.id, { title: event.title, ...event.unregisteredChecks?.length ? { unregisteredChecks: event.unregisteredChecks } : {} }, specPatch());
      await store.appendEvent(job.id, { type: "agent.status", agentId: job.id, status: "awaiting-approval", at: event.at });
    }
    await flushSpec();
    if (event.type === "approval.resolve") await store.update(job.id, { status: "running", approval: void 0 });
    if (event.type === "verify.result" && event.kind !== "reproduction") {
      latestChecks.set(event.checkId ?? event.method ?? "unknown", event.ok);
      const passed = [...latestChecks.values()].filter(Boolean).length;
      const failed = latestChecks.size - passed;
      await store.update(job.id, { verificationSummary: `${passed} passed, ${failed} failed` });
    }
    if (event.type === "outcome") await store.update(job.id, { outcome: event.label });
  };
  try {
    const available = await (options.detectClis ?? detectEngines)();
    await store.update(job.id, { status: "running", pid: process.pid });
    const host = { available, env: { ...process.env, EDU_HOME: options.globalRoot }, home: process.env.HOME || homedir(), policy: options.policy };
    const result2 = await runSession(host, {
      goal: job.goal ?? job.task,
      cwd: job.cwd,
      lang: "en",
      mode: job.orchestrationMode,
      cli: job.cli,
      harnessLevel: job.harnessLevel,
      playbook: job.playbook,
      autoApprove: job.autoApprove,
      allowUnregisteredChecks: job.allowUnregisteredChecks,
      engines: options.engineFactory,
      onEvent,
      signal: stop.signal,
      approve: async (request) => {
        if (job.autoApprove) return true;
        work.pause();
        const expires = now().getTime() + limitMs;
        try {
          while (!stop.signal.aborted) {
            const decision = await store.takeDecision(job.id);
            if (decision !== void 0) return { approved: decision.approve, by: decision.by };
            if (now().getTime() >= expires) {
              halt(`Approval gate "${request.title}" got no decision within ${minutes} minute(s); the run was stopped.`);
              break;
            }
            await sleep(250);
          }
          throw new Error(stopped ?? "Run stopped.");
        } finally {
          work.resume();
        }
      }
    });
    return await store.update(job.id, { ...specPatch(), status: result2.ok && !stopped ? "done" : "failed", endedAt: now().toISOString(), summary: stopped ?? result2.summary });
  } catch (error) {
    const message = stopped ?? (error instanceof Error ? error.message : String(error));
    await store.appendEvent(job.id, { type: "error", message, at: now().toISOString() }).catch(() => void 0);
    return await store.update(job.id, { ...specPatch(), status: "failed", endedAt: now().toISOString(), summary: message });
  } finally {
    work.clear();
  }
}

// src/crew/headless.ts
var CREW_BRAIN_ENV = "EDU_CREW_BRAIN";
function workerEnv(job, root, options = {}) {
  const platform = options.platform ?? process.platform;
  const policy = encodeWorkerPolicy(options.policy ?? { ...DEFAULT_CREW_POLICY, passthrough: [] });
  const source = { ...options.source ?? process.env, [CREW_POLICY_ENV]: policy };
  const env = {};
  for (const cli of job.kind === "orchestration" ? CLI_IDS : [job.cli]) Object.assign(env, childEnv(cli, {}, { source, platform }));
  const ownNeed = (name) => {
    const key = platform === "win32" ? name.toUpperCase() : name;
    return key.startsWith("NODE_") || key === "EDU_CREW_JOB" || key === "ALBERT_CREW_JOB";
  };
  for (const [name, value] of Object.entries(source)) if (value !== void 0 && ownNeed(name)) env[name] = value;
  const pinned = { [CREW_BRAIN_ENV]: root, [CREW_POLICY_ENV]: policy, ...options.globalRoot ? { EDU_HOME: options.globalRoot } : {} };
  for (const name of Object.keys(env)) if ((platform === "win32" ? name.toUpperCase() : name) in pinned) delete env[name];
  return Object.assign(env, pinned);
}
function envGlobalRoot(env = process.env) {
  return resolve(env.EDU_HOME || join(env.HOME || env.USERPROFILE || homedir2(), ".edu"));
}
var samePath = (a, b) => process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
function locationsFor(root, globalRoot) {
  return [{ scope: samePath(root, globalRoot) ? "global" : "project", root }];
}
var iso = (now) => now().toISOString();
function jobDigest(job) {
  const fields = [
    job.id,
    job.kind ?? "task",
    job.cli,
    job.task,
    job.goal ?? null,
    job.cwd,
    job.mode,
    job.autonomy,
    job.playbook ?? null,
    job.orchestrationMode ?? null,
    job.harnessLevel ?? null,
    job.autoApprove === true,
    job.allowUnregisteredChecks === true,
    job.timeoutMinutes ?? null
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
async function dispatchHeadless(job, options = {}) {
  const globalRoot = options.globalRoot ?? envGlobalRoot();
  const root = options.brainRoot ?? globalRoot;
  const store = createCrewStore(root, { globalRoot });
  const entry = options.entry ?? process.argv[1];
  if (!entry) throw new Error("Could not determine the Edu CLI entry point for the detached worker");
  const policy = { ...options.policy ?? await loadCrewPolicy(globalRoot), job: jobDigest(job) };
  const logDir = join(root, "crew");
  await mkdir(logDir, { recursive: true });
  const log = await open(join(logDir, `${job.id}.log`), "a");
  try {
    const child = spawn(process.execPath, [entry, "crew", "worker", job.id], {
      cwd: job.cwd,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: workerEnv(job, root, { policy, globalRoot }),
      windowsHide: true
    });
    child.once("error", (error) => {
      void store.update(job.id, { status: "failed", endedAt: (/* @__PURE__ */ new Date()).toISOString(), summary: error.message });
    });
    child.unref();
    return await store.update(job.id, { pid: child.pid });
  } finally {
    await log.close();
  }
}
async function runWorker(jobId, options = {}) {
  const globalRoot = options.globalRoot ?? envGlobalRoot();
  const root = options.brainRoot ?? globalRoot;
  const locations = options.locations ?? locationsFor(root, globalRoot);
  const store = options.store ?? createCrewStore(root, { globalRoot });
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const job = await store.get(jobId);
  if (!job) throw new Error(`Crew job not found: ${jobId}`);
  const policy = options.policy ?? { ...await loadCrewPolicy(globalRoot), job: jobDigest(job) };
  const refusal = policy.job !== void 0 && policy.job !== jobDigest(job) ? "The job record changed after dispatch; the worker refused to run it." : job.kind !== "orchestration" && !withinAutonomy(job.autonomy, policy.maxAutonomy) ? `Autonomy "${job.autonomy}" is above the crew ceiling "${policy.maxAutonomy}"; the worker refused to run it.` : void 0;
  if (refusal) return store.mutate(job.id, (current) => isTerminalCrewJobStatus(current.status) ? void 0 : { status: "failed", endedAt: iso(now), summary: refusal });
  if (job.kind === "orchestration") return runOrchestration(job, { brainRoot: root, globalRoot, policy, store, engineFactory: options.engineFactory, detectClis: options.detectClis, now: options.now, sleep: options.sleep });
  let summary = "";
  let usage = sumUsage([]);
  let failed = false;
  const timeoutMinutes = job.timeoutMinutes ?? DEFAULT_CREW_TIMEOUT_MINUTES;
  const deadline = new AbortController();
  let timer;
  try {
    const started = await store.update(job.id, { status: "running", pid: process.pid, note: void 0 });
    if (started.status !== "running") return started;
    const brain = openBrain(locations);
    const context = await brief(brain, 1200, { eduMdPath: join(locations[0].root, "EDU.md") });
    const engine = (options.engineFactory ?? createEngine)(job.cli);
    const systemPrompt = [
      "You are an Edu crew worker. Complete the user mission directly; no built-in role identity applies.",
      "Respect the requested autonomy and report a concise result, including blockers and verification.",
      context ? `
## Brain brief
${context}` : ""
    ].filter(Boolean).join("\n");
    const request = {
      invocation: { id: crypto.randomUUID(), purpose: "task" },
      cli: job.cli,
      prompt: job.task,
      cwd: job.cwd,
      autonomy: job.autonomy,
      systemPrompt,
      signal: deadline.signal,
      ...job.autonomy === "readonly" ? { requireReadonly: true } : {}
    };
    timer = setTimeout(() => deadline.abort(), timeoutMinutes * 6e4);
    for await (const event of measuredEngine(engine).run(request, job.id)) {
      const stamped = { ...event, at: event.at || iso(now) };
      await store.appendEvent(job.id, stamped);
      if (event.type === "agent.end" || event.type === "run.end") {
        summary = event.summary || summary;
        failed ||= !event.ok;
      } else if (event.type === "error") {
        summary = summary ? `${summary}
${event.message}` : event.message;
        failed = true;
      } else if (event.type === "usage") {
        usage = sumUsage([usage, event.usage]);
      }
    }
    await store.flushOutput(job.id);
    const output = await store.artifact(job.id, "output", 0, 900);
    if (deadline.signal.aborted) {
      failed = true;
      summary = `Timed out after ${timeoutMinutes} minute(s); the CLI was stopped.${summary ? `
${summary}` : ""}`;
    }
    if (!summary) summary = output.text;
    const status2 = failed ? "failed" : "done";
    const finalSummary = `${summary.trim() || (failed ? "Worker failed without a summary." : "Worker completed without a summary.")}${output.truncated ? `
[stream preview truncated; full sanitized output: edu_crew_artifact jobId=${job.id} kind=output]` : ""}`;
    const endedAt = iso(now);
    const updated = await store.update(job.id, { status: status2, endedAt, summary: finalSummary, usage });
    const episode = await brain.write({
      tier: "episodic",
      kind: "session",
      status: "closed",
      title: `Crew ${job.cli} ${updated.status}: ${job.task.slice(0, 48)}`,
      body: `Task: ${job.task}

Result: ${redactWorkerOutput(updated.summary)}

Full sanitized output: crew artifact ${job.id} output`,
      source: "edu:crew",
      tags: ["crew", job.cli]
    });
    await store.appendEvent(job.id, { type: "brain.learn", noteId: episode.meta.id, kind: "episode", title: episode.meta.title, at: endedAt });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: "error", message, at: iso(now) }).catch(() => void 0);
    return await store.update(job.id, { status: "failed", endedAt: iso(now), summary: message, usage });
  } finally {
    clearTimeout(timer);
  }
}

// src/crew/herdr.ts
import { createHash as createHash2 } from "crypto";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
var execFile = promisify(execFileCallback);
var HERDR_ATTEMPTS = 3;
var HERDR_RETRY_MS = 250;
var defaultRunner = async (args) => {
  const result2 = await execFile("herdr", args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  return { stdout: result2.stdout, stderr: result2.stderr };
};
var parse = (text) => {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object") return value;
  } catch {
  }
  throw new Error("Herdr returned invalid JSON");
};
function errorMessage(error) {
  return `Herdr error: ${error instanceof Error ? error.message : String(error)}`;
}
function readResult(text) {
  try {
    const parsed = parse(text);
    const result2 = parsed.result;
    const value = result2?.text ?? result2?.output ?? result2?.content ?? parsed.text ?? parsed.output;
    return typeof value === "string" ? value.trim() : JSON.stringify(value ?? parsed);
  } catch {
    return text.trim();
  }
}
var EDU_WORKSPACE_LABEL = "Edu";
async function herdrTarget(options = {}) {
  const env = options.env ?? process.env;
  if (!await (options.hasBinary ?? (() => binaryOnPath("herdr")))()) return { kind: "none", reason: "herdr is not on PATH" };
  if (env.HERDR_ENV === "1") return { kind: "inside" };
  let list;
  try {
    list = parse((await (options.runner ?? defaultRunner)(["workspace", "list"])).stdout);
  } catch {
    return { kind: "none", reason: "no herdr server is reachable from here" };
  }
  const workspaces = list.result?.workspaces ?? [];
  const edu = Array.isArray(workspaces) ? workspaces.find((w) => typeof w.label === "string" && w.label.trim().toLowerCase() === EDU_WORKSPACE_LABEL.toLowerCase()) : void 0;
  return { kind: "outside", workspaceId: typeof edu?.workspace_id === "string" ? edu.workspace_id : void 0 };
}
async function openPane(job, target, runner, agentName) {
  const worker = ["--env", `EDU_CREW_JOB=${job.id}`];
  if (target.kind === "inside") {
    const split = parse((await runner(["pane", "split", "--current", "--direction", "right", "--cwd", job.cwd, ...worker, "--no-focus"])).stdout);
    const pane2 = split.result?.pane;
    return typeof pane2?.pane_id === "string" ? pane2.pane_id : void 0;
  }
  const args = target.workspaceId ? ["tab", "create", "--workspace", target.workspaceId, "--cwd", job.cwd, "--label", agentName, ...worker, "--no-focus"] : ["workspace", "create", "--cwd", job.cwd, "--label", EDU_WORKSPACE_LABEL, ...worker, "--no-focus"];
  const created = parse((await runner(args)).stdout).result;
  const pane = created?.root_pane ?? created?.pane;
  return typeof pane?.pane_id === "string" ? pane.pane_id : void 0;
}
async function dispatchPane(job, options = {}) {
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ""}/.edu`);
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  let paneId;
  let agentStarted = false;
  try {
    const target = options.target ?? await herdrTarget(options);
    if (target.kind === "none") throw new Error(`Herdr pane mode unavailable: ${target.reason}`);
    const agentName = `edu-${job.id.slice(0, 8)}`;
    paneId = await openPane(job, target, runner, agentName);
    if (typeof paneId !== "string" || !paneId) throw new Error(target.kind === "inside" ? "Herdr pane split did not return result.pane.pane_id" : "Herdr did not return result.root_pane.pane_id");
    const where = target.kind === "outside" ? `Visible in herdr workspace "${EDU_WORKSPACE_LABEL}", pane ${paneId}.` : void 0;
    const cliArgs = [...interactiveAutonomyFlags(job.cli, job.autonomy), ...job.cli === "codex" ? ["--no-daemon"] : []];
    const agentArgs = cliArgs.length ? ["--", ...cliArgs] : [];
    const prompt = job.task;
    try {
      await runner(["agent", "start", agentName, "--kind", job.cli, "--pane", paneId, ...agentArgs]);
      agentStarted = true;
    } catch (error) {
      if (!/agent_not_ready/.test(errorMessage(error))) throw error;
      agentStarted = true;
      const question = await lastPaneLines(paneId, options).catch(() => "");
      return await store.update(job.id, {
        status: "running",
        paneId,
        agentName,
        pendingPrompt: prompt,
        note: `${job.cli} is waiting for your answer in herdr pane ${paneId}. Answer it there; Edu sends the task as soon as it is ready.${question ? `
${question}` : ""}`
      });
    }
    await sendPrompt(runner, agentName, prompt);
    return await store.update(job.id, { status: "running", paneId, agentName, note: where, ...await promptBaseline(agentName, paneId, options, now) });
  } catch (error) {
    let summary = errorMessage(error);
    if (paneId && !agentStarted) {
      try {
        await runner(["pane", "close", paneId]);
      } catch (cleanupError) {
        summary += `; pane cleanup failed: ${errorMessage(cleanupError)}`;
      }
    }
    return store.update(job.id, { status: "failed", endedAt: now().toISOString(), summary });
  }
}
function sendPrompt(runner, agentName, prompt) {
  return runner(["agent", "prompt", agentName, "--", prompt]);
}
var GONE = /not[_ ]found|no such (?:agent|pane)|unknown (?:agent|pane)/i;
async function refreshPane(job, options = {}) {
  if (isTerminalCrewJobStatus(job.status) || !job.agentName) return job;
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ""}/.edu`);
  const sleep = options.sleep ?? ((ms) => new Promise((resolve3) => setTimeout(resolve3, ms)));
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  let lastError;
  for (let attempt = 1; attempt <= HERDR_ATTEMPTS; attempt++) {
    try {
      return await refreshOnce(job, store, options);
    } catch (error) {
      lastError = error;
      if (GONE.test(errorMessage(error)) || attempt === HERDR_ATTEMPTS) break;
      await sleep(HERDR_RETRY_MS * attempt);
    }
  }
  const paneTail = job.paneId ? await lastPaneLines(job.paneId, options).catch(() => "") : "";
  const summary = paneTail ? `Agent exited. Last pane output:
${paneTail}` : errorMessage(lastError);
  return store.update(job.id, { status: "failed", endedAt: now().toISOString(), summary });
}
async function refreshOnce(job, store, options) {
  const agentName = job.agentName;
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const { status: status2, seq } = await agentState(agentName, options);
  if (job.pendingPrompt) {
    if (status2 !== "idle" && status2 !== "done") return job;
    let claimed;
    const current = await store.mutate(job.id, (latest) => {
      if (!latest.pendingPrompt || isTerminalCrewJobStatus(latest.status)) return void 0;
      claimed = latest.pendingPrompt;
      return { pendingPrompt: void 0, note: void 0 };
    });
    if (claimed === void 0) return current;
    try {
      await sendPrompt(runner, agentName, claimed);
    } catch (error) {
      await store.mutate(job.id, (latest) => latest.pendingPrompt || isTerminalCrewJobStatus(latest.status) ? void 0 : { pendingPrompt: claimed });
      throw error;
    }
    return store.update(job.id, await promptBaseline(agentName, job.paneId, options, now));
  }
  if (status2 === "working" || status2 === "blocked") {
    await appendPaneOutput(job, store, options);
    return job.observedWorking ? job : store.update(job.id, { observedWorking: true });
  }
  let changedSincePrompt = seq !== void 0 && job.promptSeq !== void 0 && seq > job.promptSeq;
  const settledFor = job.promptedAt ? now().getTime() - Date.parse(job.promptedAt) : 0;
  if (!changedSincePrompt && (status2 === "idle" || status2 === "done") && job.paneId && job.promptPaneHash && settledFor >= 5e3) {
    changedSincePrompt = await paneHash(job.paneId, options).catch(() => job.promptPaneHash) !== job.promptPaneHash;
  }
  if ((status2 === "done" || status2 === "idle") && (job.observedWorking || changedSincePrompt)) {
    await appendPaneOutput(job, store, options);
    const output = await runner(["agent", "read", agentName, "--source", "recent-unwrapped", "--lines", "200"]);
    const unchanged = job.promptPaneHash !== void 0 && createHash2("sha256").update(output.stdout).digest("hex") === job.promptPaneHash;
    const answer = unchanged ? void 0 : paneAnswer(readResult(output.stdout), job.task);
    return store.update(job.id, { status: "done", endedAt: now().toISOString(), summary: answer ?? unreadableAnswer(job) });
  }
  if (status2 === "failed" || status2 === "error") {
    await appendPaneOutput(job, store, options);
    return store.update(job.id, { status: "failed", endedAt: now().toISOString(), summary: `Herdr agent ${status2}` });
  }
  return job;
}
var INPUT_MARKER = /^(?:[│┃]\s*)?[>›❯](?:\s|$)/;
var PASTED = /\[Pasted (?:text|content)\b[^\]]*\]/i;
var CHROME = /^[\s─━│┃║═╭╮╰╯┌┐└┘├┤┬┴┼╔╗╚╝]*$/;
var squash = (text) => text.replace(/[│┃║]/g, " ").replace(/\s+/g, " ").trim();
function paneAnswer(screen, prompt) {
  const lines = screen.replace(/\r/g, "").split("\n").map((line) => line.trimEnd());
  const echo = echoEnd(lines, prompt);
  let start = echo === void 0 ? 0 : echo + 1;
  let end = lines.length;
  for (let index = end - 1; index >= start; index--) if (INPUT_MARKER.test(lines[index])) {
    end = index;
    break;
  }
  while (start < end && CHROME.test(lines[start])) start++;
  while (end > start && CHROME.test(lines[end - 1])) end--;
  return lines.slice(start, end).join("\n").trim() || void 0;
}
function echoEnd(lines, prompt) {
  const offsets = [];
  let joined = "";
  for (const line of lines) {
    offsets.push(joined.length);
    joined += `${squash(line)} `;
  }
  const lineAt = (offset) => {
    let index = 0;
    while (index + 1 < offsets.length && offsets[index + 1] <= offset) index++;
    return index;
  };
  const needle = squash(prompt).slice(-48);
  if (needle) {
    let first;
    for (let at = joined.indexOf(needle); at !== -1; at = joined.indexOf(needle, at + 1)) {
      first ??= at;
      if (INPUT_MARKER.test(lines[lineAt(at)])) return lineAt(at + needle.length - 1);
    }
    if (first !== void 0) return lineAt(first + needle.length - 1);
  }
  const pasted = lines.findIndex((line) => INPUT_MARKER.test(line) && PASTED.test(line));
  return pasted === -1 ? void 0 : pasted;
}
function unreadableAnswer(job) {
  return `The agent finished, but its answer could not be read from herdr pane ${job.paneId ?? job.agentName}: nothing after the prompt is on the screen herdr returns. The CLI likely drew it on the terminal's alternate screen, whose rows never reach herdr's scrollback. Read the answer in the pane.`;
}
async function closePane(job, options = {}) {
  if (!job.paneId) return;
  await (options.runner ?? defaultRunner)(["pane", "close", job.paneId]);
}
async function appendPaneOutput(job, store, options) {
  if (!job.paneId) return;
  const text = await lastPaneLines(job.paneId, options).catch(() => "");
  if (!text) return;
  if (lastPaneSnapshots.get(job.id) === text) return;
  await store.appendEvent(job.id, { type: "agent.text", agentId: job.id, text, at: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString() });
  lastPaneSnapshots.set(job.id, text);
}
var lastPaneSnapshots = /* @__PURE__ */ new Map();
async function agentState(name, options) {
  const raw = parse((await (options.runner ?? defaultRunner)(["agent", "get", name])).stdout);
  const result2 = raw.result;
  const agent = result2?.agent;
  const reported = [agent?.agent_status, agent?.status, agent?.state, result2?.agent_status, result2?.status, raw.status].find((value) => value !== void 0 && value !== null);
  const status2 = (typeof reported === "string" ? reported : "").toLowerCase();
  const seq = typeof agent?.state_change_seq === "number" ? agent.state_change_seq : void 0;
  return { status: status2, seq };
}
async function paneHash(paneId, options) {
  const output = await (options.runner ?? defaultRunner)(["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "200"]);
  return createHash2("sha256").update(output.stdout).digest("hex");
}
async function promptBaseline(name, paneId, options, now) {
  const state = await agentState(name, options).catch(() => void 0);
  const hash = paneId ? await paneHash(paneId, options).catch(() => void 0) : void 0;
  return { promptSeq: state?.seq, promptPaneHash: hash, promptedAt: now().toISOString() };
}
async function lastPaneLines(paneId, options) {
  const output = await (options.runner ?? defaultRunner)(["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "12"]);
  return output.stdout.trim().split("\n").slice(-8).join("\n");
}

// src/crew/index.ts
var execFile2 = promisify2(execFileCallback2);
var OVERDUE_GRACE_MS = 5 * 6e4;
async function configuredTimeout(root) {
  try {
    const raw = JSON.parse(await readFile(join2(root, "config.json"), "utf8"));
    const minutes = raw?.crew?.timeoutMinutes;
    return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : void 0;
  } catch {
    return void 0;
  }
}
function validTimeout(minutes) {
  if (minutes === void 0) return void 0;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Crew timeout must be a whole number of minutes from 1 to 1440");
  return minutes;
}
function isWorkerOf(description, jobId, _platform = process.platform) {
  return Boolean(description) && description.includes("crew") && description.includes(jobId);
}
function createCrew(options = {}) {
  const globalRoot = resolve2(options.globalRoot ?? options.locations?.find((location) => location.scope === "global")?.root ?? envGlobalRoot());
  const root = options.brainRoot ?? options.locations?.[0]?.root ?? globalRoot;
  const store = options.store ?? createCrewStore(root, { globalRoot });
  const policy = () => loadCrewPolicy(globalRoot);
  const start = (job, current) => (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root, globalRoot, policy: current });
  const engineFactory = options.engineFactory ?? createEngine;
  const detect = options.detectClis ?? detectEngines;
  const sleep = options.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const clock = options.clock ?? Date.now;
  const isAlive = options.isAlive ?? processAlive;
  const describe = options.describeProcess ?? describeProcess;
  const stop = options.stopProcess ?? ((pid, signal) => killTree({ pid }, signal));
  const readonlyEnforced = (cli) => measuredEngine(engineFactory(cli)).capabilities?.readonly === "enforced";
  const timeoutFor = async (requested) => validTimeout(requested) ?? validTimeout(options.timeoutMinutes) ?? await configuredTimeout(root) ?? (resolve2(root) === globalRoot ? void 0 : await configuredTimeout(globalRoot)) ?? DEFAULT_CREW_TIMEOUT_MINUTES;
  async function sweep(job) {
    if (isTerminalCrewJobStatus(job.status) || job.pid === void 0) return job;
    const dead = !isAlive(job.pid);
    const limit = (job.timeoutMinutes ?? DEFAULT_CREW_TIMEOUT_MINUTES) * 6e4;
    const overdue = job.kind !== "orchestration" && job.status === "running" && clock() > Date.parse(job.createdAt) + limit + OVERDUE_GRACE_MS;
    if (!dead && !overdue) return job;
    return store.mutate(job.id, (current) => isTerminalCrewJobStatus(current.status) || current.pid !== job.pid ? void 0 : {
      status: "failed",
      endedAt: new Date(clock()).toISOString(),
      summary: dead ? `Worker process ${job.pid} stopped without finishing the job.` : `Worker exceeded its ${limit / 6e4}-minute timeout and stopped reporting.`
    });
  }
  async function expirePane(job) {
    const minutes = job.timeoutMinutes ?? DEFAULT_CREW_TIMEOUT_MINUTES;
    if (isTerminalCrewJobStatus(job.status) || clock() <= Date.parse(job.createdAt) + minutes * 6e4) return void 0;
    let expired = false;
    const failed = await store.mutate(job.id, (current) => {
      if (isTerminalCrewJobStatus(current.status)) return void 0;
      expired = true;
      return { status: "failed", endedAt: new Date(clock()).toISOString(), summary: `Timed out after ${minutes} minute(s); the pane agent was stopped.` };
    });
    if (!expired) return failed;
    try {
      await closePane(failed, { ...options.herdr, store, brainRoot: root });
    } catch (error) {
      return store.update(job.id, { note: `Could not close pane ${failed.paneId ?? ""}: ${error instanceof Error ? error.message : String(error)}` });
    }
    return failed;
  }
  const refresh = async (job) => job.mode === "pane" ? await expirePane(job) ?? refreshPane(job, { ...options.herdr, store, brainRoot: root }) : sweep(job);
  async function stopWorker(job) {
    const pid = job.pid;
    if (pid === void 0 || !isAlive(pid)) return void 0;
    if (!isWorkerOf(await describe(pid), job.id)) return `Process ${pid} is no longer this job's worker; nothing was signalled.`;
    await stop(pid, "SIGTERM");
    const deadline = clock() + (options.cancelGraceMs ?? 3e3);
    while (isAlive(pid) && clock() < deadline) await sleep(50);
    if (isAlive(pid)) await stop(pid, "SIGKILL");
    return void 0;
  }
  const workspaceRoot = options.workspaceRoot ?? (options.locations?.find((loc) => loc.scope === "project")?.root ? dirname(options.locations.find((loc) => loc.scope === "project").root) : options.brainRoot ? basename(options.brainRoot) === ".edu" ? dirname(options.brainRoot) : options.brainRoot : process.cwd());
  return {
    async orchestrate(input) {
      if (!input.goal.trim()) throw new Error("Orchestration goal must not be empty");
      const boundary = await realpath(workspaceRoot);
      const cwd = await realpath(resolve2(input.cwd ?? workspaceRoot));
      const fromBoundary = relative(boundary, cwd);
      if (fromBoundary === ".." || fromBoundary.startsWith(`..${sep}`) || isAbsolute(fromBoundary)) throw new Error(`Crew orchestration cwd is outside the workspace: ${cwd}`);
      const available = await detect();
      const cli = input.cli ?? available[0];
      if (!cli || !available.includes(cli)) throw new Error("No available CLI for orchestration");
      const current = await policy();
      const timeoutMinutes = await timeoutFor(input.timeoutMinutes);
      const job = await store.create({ cli, task: input.goal.trim(), goal: input.goal.trim(), kind: "orchestration", mode: "headless", cwd, autonomy: "auto", orchestrationMode: input.mode, playbook: input.playbook, harnessLevel: input.harnessLevel, autoApprove: input.autoApprove, allowUnregisteredChecks: input.allowUnregisteredChecks, timeoutMinutes });
      await store.update(job.id, { status: "running" });
      try {
        return await start(job, current);
      } catch (error) {
        await store.update(job.id, { status: "failed", endedAt: (/* @__PURE__ */ new Date()).toISOString(), summary: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    /** Decides the open gate. Without a `requestId` it decides the gate open right now (a person at the CLI). */
    async approve(jobId, approved, decision) {
      const job = await store.get(jobId);
      if (!job) throw new Error(`Crew job not found: ${jobId}`);
      const requestId = decision.requestId ?? job.approval?.requestId;
      if (!requestId) throw new Error(`Crew job is not awaiting approval: ${jobId}`);
      await store.decide(job.id, approved, { requestId, by: decision.by, env: decision.env });
      return await store.get(job.id);
    },
    async dispatch(input) {
      if (!input.task.trim()) throw new Error("Crew task must not be empty");
      const boundary = await realpath(workspaceRoot);
      const cwd = await realpath(resolve2(input.cwd ?? workspaceRoot));
      const fromBoundary = relative(boundary, cwd);
      if (fromBoundary === ".." || fromBoundary.startsWith(`..${sep}`) || isAbsolute(fromBoundary)) {
        throw new Error(`Crew dispatch cwd is outside the workspace: ${input.cwd ?? cwd}`);
      }
      const autonomy = input.autonomy ?? "ask";
      if (autonomy === "readonly" && !enforcesReadonly(input.cli)) {
        throw new Error(`${input.cli} cannot enforce read-only work; dispatch it to claude, codex or pi, or choose another autonomy level`);
      }
      const current = await policy();
      if (!withinAutonomy(autonomy, current.maxAutonomy)) {
        throw new Error(`Autonomy "${autonomy}" is above the crew ceiling "${current.maxAutonomy}". A person can raise crew.maxAutonomy in the global Edu config (${join2(globalRoot, "config.json")}).`);
      }
      const timeoutMinutes = await timeoutFor(input.timeoutMinutes);
      const requestedMode = input.mode ?? "headless";
      const target = requestedMode === "pane" ? await herdrTarget(options.herdr) : void 0;
      const pane = target !== void 0 && target.kind !== "none";
      const job = await store.create({ cli: input.cli, task: input.task.trim(), mode: pane ? "pane" : "headless", cwd, autonomy, timeoutMinutes });
      if (target?.kind === "none") await store.update(job.id, { note: `Herdr unavailable (${target.reason}); dispatched as headless.` });
      if (pane) return dispatchPane(job, { ...options.herdr, store, brainRoot: root, target });
      return start(job, current);
    },
    async status(jobId) {
      if (jobId) {
        const job = await store.get(jobId);
        if (!job) throw new Error(`Crew job not found: ${jobId}`);
        return refresh(job);
      }
      const jobs = await store.list();
      return Promise.all(jobs.map(refresh));
    },
    async result(jobId, waitSeconds = 0) {
      if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error("waitSeconds must be a non-negative number");
      const deadline = clock() + Math.floor(waitSeconds * 1e3);
      while (true) {
        const current = await this.status(jobId);
        if (isTerminalCrewJobStatus(current.status) || clock() >= deadline) return current;
        await sleep(Math.min(250, Math.max(1, deadline - clock())));
      }
    },
    /**
     * Cancels a job: marks it `cancelled` first (so the dying worker's own write cannot win), then stops
     * its worker process tree, or closes its herdr pane. A finished job is returned unchanged.
     */
    async cancel(jobId) {
      const job = await store.get(jobId);
      if (!job) throw new Error(`Crew job not found: ${jobId}`);
      const cancelled = await store.mutate(job.id, (current) => isTerminalCrewJobStatus(current.status) ? void 0 : {
        status: "cancelled",
        endedAt: new Date(clock()).toISOString(),
        summary: "Cancelled on request."
      });
      if (cancelled.status !== "cancelled" || isTerminalCrewJobStatus(job.status)) return cancelled;
      let note;
      try {
        if (cancelled.mode === "pane") await closePane(cancelled, { ...options.herdr, store, brainRoot: root });
        else note = await stopWorker(cancelled);
      } catch (error) {
        note = `Could not stop the job's process: ${error instanceof Error ? error.message : String(error)}`;
      }
      return note ? store.update(job.id, { note }) : cancelled;
    },
    async review(input = {}) {
      const available = await detect();
      const callerEnv = options.callerEnv ?? process.env;
      const caller = input.callerCli ?? (callerEnv.ANTIGRAVITY || callerEnv.ANTIGRAVITY_AGENT || callerEnv.GEMINI_CLI ? "agy" : void 0);
      const reviewer = input.cli ?? available.find((cli) => cli !== caller && readonlyEnforced(cli));
      if (!reviewer || !available.includes(reviewer)) throw new Error("No available read-only reviewer CLI different from the caller (claude, codex or pi); specify an installed --cli");
      if (!readonlyEnforced(reviewer)) throw new Error(`${reviewer} cannot enforce a read-only review; use claude, codex or pi`);
      const base = input.base ?? "HEAD";
      const rawDiff = await (options.diff ?? defaultDiff)(base, workspaceRoot);
      const prompt = `Review the following changes. Do not modify files. Return concrete findings first, then residual risks.

\`\`\`diff
${truncateToTokens(rawDiff, 6e3)}
\`\`\``;
      let summary = "";
      for await (const event of measuredEngine(engineFactory(reviewer)).run({ invocation: { id: crypto.randomUUID(), purpose: "review" }, cli: reviewer, prompt, cwd: workspaceRoot, autonomy: "readonly", requireReadonly: true, systemPrompt: "You are an independent, read-only code reviewer. Never request write access." }, `review-${Date.now()}`)) {
        if (event.type === "agent.text") summary += event.text;
        else if (event.type === "agent.end" || event.type === "run.end") {
          if (!event.ok) throw new Error("reviewer ended unsuccessfully");
          if (event.summary) summary = event.summary;
        } else if (event.type === "error") throw new Error(`Crew review failed: ${event.message}`);
      }
      return { cli: reviewer, summary: summary.trim() || "Reviewer returned no findings." };
    },
    runWorker: (jobId) => runWorker(jobId, { brainRoot: root, globalRoot, locations: options.locations, store, engineFactory, detectClis: detect, sleep }),
    store
  };
}
async function defaultDiff(base, cwd) {
  let inside;
  try {
    inside = (await execFile2("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" })).stdout.trim();
  } catch {
    throw new Error("cross-vendor review needs a git repository to diff; run it inside a repo or pass files");
  }
  if (inside !== "true") throw new Error("cross-vendor review needs a git repository to diff; run it inside a repo or pass files");
  if (base.startsWith("-") || base.includes("\0")) throw new Error(`Unknown git base ref: ${base}`);
  try {
    await execFile2("git", ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], { cwd, encoding: "utf8" });
  } catch {
    throw new Error(`Unknown git base ref: ${base}`);
  }
  const result2 = await execFile2("git", ["diff", "--no-ext-diff", "--no-textconv", base, "--"], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return result2.stdout;
}
var defaultCrew = createCrew();
var dispatch = (input) => defaultCrew.dispatch(input);
var status = (jobId) => defaultCrew.status(jobId);
var result = (jobId, waitSeconds) => defaultCrew.result(jobId, waitSeconds);
var review = (input) => defaultCrew.review(input);
var cancel = (jobId) => defaultCrew.cancel(jobId);

export {
  CREW_BRAIN_ENV,
  runWorker,
  isWorkerOf,
  createCrew,
  dispatch,
  status,
  result,
  review,
  cancel
};
//# sourceMappingURL=chunk-CMOEIR57.js.map