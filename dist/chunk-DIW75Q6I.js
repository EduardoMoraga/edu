import {
  createEngine,
  detectEngines
} from "./chunk-H52HBKSP.js";
import {
  binaryOnPath
} from "./chunk-ROTDA577.js";
import {
  brief,
  truncateToTokens
} from "./chunk-QJZCSCYS.js";
import {
  openBrain
} from "./chunk-NPS5KFAC.js";

// src/crew/index.ts
import { execFile as execFileCallback2 } from "child_process";
import { promisify as promisify2 } from "util";
import { homedir as homedir2 } from "os";
import { realpath } from "fs/promises";
import { basename, dirname, isAbsolute, join as join3, relative, resolve as resolve2, sep } from "path";

// src/crew/headless.ts
import { open, mkdir as mkdir2 } from "fs/promises";
import { homedir } from "os";
import { join as join2, resolve } from "path";
import { spawn } from "child_process";

// src/crew/store.ts
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
var statuses = /* @__PURE__ */ new Set(["queued", "running", "done", "failed", "cancelled"]);
var safeId = (id) => {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`Invalid crew job id: ${id}`);
  return id;
};
function createCrewStore(brainRoot) {
  const root = join(brainRoot, "crew");
  const metaPath = (id) => join(root, `${safeId(id)}.json`);
  const eventPath = (id) => join(root, `${safeId(id)}.jsonl`);
  const ensure = () => mkdir(root, { recursive: true });
  async function atomicJson(path, value) {
    await ensure();
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}
`, { flag: "wx" });
      await rename(temporary, path);
    } catch (error) {
      const { unlink } = await import("fs/promises");
      await unlink(temporary).catch(() => void 0);
      throw error;
    }
  }
  return {
    async create(input) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const job = { ...input, id: randomUUID(), status: "queued", createdAt: now, summary: "", usage: { inputTokens: 0, outputTokens: 0 } };
      await atomicJson(metaPath(job.id), job);
      await writeFile(eventPath(job.id), "", { flag: "wx" });
      return job;
    },
    async get(input) {
      let id = input;
      if (/^[a-f0-9-]{4,35}$/i.test(input)) {
        const { readdir: readdir2 } = await import("fs/promises");
        const matches = (await readdir2(root).catch(() => [])).filter((f) => f.endsWith(".json") && f.startsWith(input.toLowerCase()));
        if (matches.length > 1) throw new Error(`Ambiguous crew job id prefix: ${input}`);
        if (matches.length === 0) return void 0;
        id = matches[0].slice(0, -".json".length);
      }
      try {
        const job = JSON.parse(await readFile(metaPath(id), "utf8"));
        if (!job || typeof job !== "object" || !("id" in job) || !("status" in job) || !statuses.has(job.status)) throw new Error(`Invalid crew job record: ${id}`);
        return job;
      } catch (error) {
        if (error.code === "ENOENT") return void 0;
        throw error;
      }
    },
    async list() {
      await ensure();
      const files = (await readdir(root)).filter((file) => /^[a-f0-9-]{36}\.json$/i.test(file));
      const jobs = await Promise.all(files.map((file) => this.get(file.slice(0, -5))));
      return jobs.filter((job) => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async update(id, patch) {
      const current = await this.get(id);
      if (!current) throw new Error(`Crew job not found: ${id}`);
      if (patch.status && !statuses.has(patch.status)) throw new Error(`Invalid crew job status: ${patch.status}`);
      const updated = { ...current, ...patch };
      await atomicJson(metaPath(id), updated);
      return updated;
    },
    async appendEvent(id, event) {
      if (!await this.get(id)) throw new Error(`Crew job not found: ${id}`);
      await appendFile(eventPath(id), `${JSON.stringify(event)}
`, "utf8");
    },
    async events(id) {
      if (!await this.get(id)) throw new Error(`Crew job not found: ${id}`);
      const text = await readFile(eventPath(id), "utf8");
      return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    }
  };
}

// src/crew/headless.ts
function defaultBrainRoot() {
  return resolve(process.env.EDU_HOME || join2(homedir(), ".edu"));
}
function locationsFor(root) {
  return [{ scope: "global", root }];
}
var iso = (now) => now().toISOString();
async function dispatchHeadless(job, options = {}) {
  const root = options.brainRoot ?? defaultBrainRoot();
  const store = createCrewStore(root);
  const entry = options.entry ?? process.argv[1];
  if (!entry) throw new Error("Could not determine the Edu CLI entry point for the detached worker");
  const logDir = join2(root, "crew");
  await mkdir2(logDir, { recursive: true });
  const log = await open(join2(logDir, `${job.id}.log`), "a");
  try {
    const child = spawn(process.execPath, [entry, "crew", "worker", job.id], {
      cwd: job.cwd,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env, EDU_HOME: root },
      windowsHide: true
    });
    child.once("error", (error) => {
      void store.update(job.id, { status: "failed", endedAt: (/* @__PURE__ */ new Date()).toISOString(), summary: error.message });
    });
    child.unref();
    return store.update(job.id, { status: "running", pid: child.pid });
  } finally {
    await log.close();
  }
}
async function runWorker(jobId, options = {}) {
  const root = options.brainRoot ?? defaultBrainRoot();
  const locations = options.locations ?? locationsFor(root);
  const store = options.store ?? createCrewStore(root);
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const job = await store.get(jobId);
  if (!job) throw new Error(`Crew job not found: ${jobId}`);
  let summary = "";
  const usage = { inputTokens: 0, outputTokens: 0 };
  let failed = false;
  try {
    await store.update(job.id, { status: "running", pid: process.pid, note: void 0 });
    const brain = openBrain(locations);
    const context = await brief(brain, 1200, { eduMdPath: join2(locations[0].root, "EDU.md") });
    const engine = (options.engineFactory ?? createEngine)(job.cli);
    const systemPrompt = [
      "You are an Edu crew worker. Complete the user mission directly; no built-in role identity applies.",
      "Respect the requested autonomy and report a concise result, including blockers and verification.",
      context ? `
## Brain brief
${context}` : ""
    ].filter(Boolean).join("\n");
    for await (const event of engine.run({ cli: job.cli, prompt: job.task, cwd: job.cwd, autonomy: job.autonomy, systemPrompt }, job.id)) {
      const stamped = { ...event, at: event.at || iso(now) };
      await store.appendEvent(job.id, stamped);
      if (event.type === "agent.text") summary += event.text;
      else if (event.type === "agent.end" || event.type === "run.end") {
        summary = event.summary || summary;
        failed ||= !event.ok;
      } else if (event.type === "error") {
        summary = summary ? `${summary}
${event.message}` : event.message;
        failed = true;
      } else if (event.type === "usage") {
        usage.inputTokens += event.usage.inputTokens;
        usage.outputTokens += event.usage.outputTokens;
        usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (event.usage.cacheReadTokens ?? 0);
        usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (event.usage.cacheWriteTokens ?? 0);
        if (event.usage.costUsd !== void 0) usage.costUsd = (usage.costUsd ?? 0) + event.usage.costUsd;
      }
    }
    const status = failed ? "failed" : "done";
    const finalSummary = summary.trim() || (failed ? "Worker failed without a summary." : "Worker completed without a summary.");
    const endedAt = iso(now);
    const updated = await store.update(job.id, { status, endedAt, summary: finalSummary, usage });
    const episode = await brain.write({
      tier: "episodic",
      kind: "session",
      status: "closed",
      title: `Crew ${job.cli} ${status}: ${job.task.slice(0, 48)}`,
      body: `Task: ${job.task}

Result: ${finalSummary}`,
      source: "edu:crew",
      tags: ["crew", job.cli]
    });
    await store.appendEvent(job.id, { type: "brain.learn", noteId: episode.meta.id, kind: "episode", title: episode.meta.title, at: endedAt });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: "error", message, at: iso(now) }).catch(() => void 0);
    return store.update(job.id, { status: "failed", endedAt: iso(now), summary: message, usage });
  }
}

// src/crew/herdr.ts
import { createHash } from "crypto";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
var execFile = promisify(execFileCallback);
var defaultRunner = async (args) => {
  const result = await execFile("herdr", args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
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
    const result = parsed.result;
    const value = result?.text ?? result?.output ?? result?.content ?? parsed.text ?? parsed.output;
    return typeof value === "string" ? value.trim() : JSON.stringify(value ?? parsed);
  } catch {
    return text.trim();
  }
}
async function herdrAvailable(options = {}) {
  return (options.env ?? process.env).HERDR_ENV === "1" && await (options.hasBinary ?? (() => binaryOnPath("herdr")))();
}
async function dispatchPane(job, options = {}) {
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ""}/.edu`);
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  let paneId;
  let agentStarted = false;
  try {
    if (!await herdrAvailable(options)) throw new Error("Herdr pane mode requires HERDR_ENV=1 and herdr on PATH");
    const split = parse((await runner(["pane", "split", "--current", "--direction", "right", "--cwd", job.cwd, "--no-focus"])).stdout);
    const result = split.result;
    const pane = result?.pane;
    paneId = typeof pane?.pane_id === "string" ? pane.pane_id : void 0;
    if (typeof paneId !== "string" || !paneId) throw new Error("Herdr pane split did not return result.pane.pane_id");
    const agentName = `edu-${job.id.slice(0, 8)}`;
    const autonomyPrompt = job.autonomy === "readonly" ? "Autonomy policy: readonly. Do not modify files or take other write actions." : `Autonomy policy: ${job.autonomy}. Follow this level for all requested actions.`;
    const agentArgs = job.cli === "codex" ? ["--", "--no-daemon"] : [];
    const prompt = `${autonomyPrompt}

Mission: ${job.task}`;
    try {
      await runner(["agent", "start", agentName, "--kind", job.cli, "--pane", paneId, ...agentArgs]);
      agentStarted = true;
    } catch (error) {
      if (!/agent_not_ready/.test(errorMessage(error))) throw error;
      agentStarted = true;
      const question = await lastPaneLines(paneId, options).catch(() => "");
      return store.update(job.id, {
        status: "running",
        paneId,
        agentName,
        pendingPrompt: prompt,
        note: `${job.cli} is waiting for your answer in herdr pane ${paneId}. Answer it there; Edu sends the task as soon as it is ready.${question ? `
${question}` : ""}`
      });
    }
    await runner(["agent", "prompt", agentName, prompt]);
    return store.update(job.id, { status: "running", paneId, agentName, note: void 0, ...await promptBaseline(agentName, paneId, options, now) });
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
async function refreshPane(job, options = {}) {
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled" || !job.agentName) return job;
  const store = options.store ?? createCrewStore(options.brainRoot ?? process.env.EDU_HOME ?? `${process.env.HOME ?? ""}/.edu`);
  try {
    const { status, seq } = await agentState(job.agentName, options);
    if (job.pendingPrompt) {
      if (status !== "idle" && status !== "done") return job;
      await (options.runner ?? defaultRunner)(["agent", "prompt", job.agentName, job.pendingPrompt]);
      return store.update(job.id, { pendingPrompt: void 0, note: void 0, ...await promptBaseline(job.agentName, job.paneId, options, options.now ?? (() => /* @__PURE__ */ new Date())) });
    }
    if (status === "working" || status === "blocked") {
      await appendPaneOutput(job, store, options);
      return job.observedWorking ? job : store.update(job.id, { observedWorking: true });
    }
    let changedSincePrompt = seq !== void 0 && job.promptSeq !== void 0 && seq > job.promptSeq;
    const settledFor = job.promptedAt ? (options.now ?? (() => /* @__PURE__ */ new Date()))().getTime() - Date.parse(job.promptedAt) : 0;
    if (!changedSincePrompt && status === "idle" && job.paneId && job.promptPaneHash && settledFor >= 5e3) {
      changedSincePrompt = await paneHash(job.paneId, options).catch(() => job.promptPaneHash) !== job.promptPaneHash;
    }
    if (status === "done" || status === "idle" && (job.observedWorking || changedSincePrompt)) {
      await appendPaneOutput(job, store, options);
      const output = await (options.runner ?? defaultRunner)(["agent", "read", job.agentName, "--source", "recent-unwrapped", "--lines", "200"]);
      return store.update(job.id, { status: "done", endedAt: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(), summary: readResult(output.stdout) });
    }
    if (status === "failed" || status === "error") {
      await appendPaneOutput(job, store, options);
      return store.update(job.id, { status: "failed", endedAt: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(), summary: `Herdr agent ${status}` });
    }
    return job;
  } catch (error) {
    const paneTail = job.paneId ? await lastPaneLines(job.paneId, options).catch(() => "") : "";
    const summary = paneTail ? `Agent exited. Last pane output:
${paneTail}` : errorMessage(error);
    return store.update(job.id, { status: "failed", endedAt: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(), summary });
  }
}
async function appendPaneOutput(job, store, options) {
  if (!job.paneId) return;
  const text = await lastPaneLines(job.paneId, options).catch(() => "");
  if (!text) return;
  const previous = (await store.events(job.id)).filter((event) => event.type === "agent.text").at(-1);
  if (previous?.type === "agent.text" && previous.text === text) return;
  await store.appendEvent(job.id, { type: "agent.text", agentId: job.id, text, at: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString() });
}
async function agentState(name, options) {
  const raw = parse((await (options.runner ?? defaultRunner)(["agent", "get", name])).stdout);
  const result = raw.result;
  const agent = result?.agent;
  const status = String(agent?.agent_status ?? agent?.status ?? agent?.state ?? result?.agent_status ?? result?.status ?? raw.status ?? "").toLowerCase();
  const seq = typeof agent?.state_change_seq === "number" ? agent.state_change_seq : void 0;
  return { status, seq };
}
async function paneHash(paneId, options) {
  const output = await (options.runner ?? defaultRunner)(["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "200"]);
  return createHash("sha256").update(output.stdout).digest("hex");
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
var defaultRoot = () => resolve2(process.env.EDU_HOME || join3(homedir2(), ".edu"));
function createCrew(options = {}) {
  const root = options.brainRoot ?? options.locations?.[0]?.root ?? defaultRoot();
  const store = options.store ?? createCrewStore(root);
  const engineFactory = options.engineFactory ?? createEngine;
  const detect = options.detectClis ?? detectEngines;
  const sleep = options.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const clock = options.clock ?? Date.now;
  const workspaceRoot = options.workspaceRoot ?? (options.locations?.find((loc) => loc.scope === "project")?.root ? dirname(options.locations.find((loc) => loc.scope === "project").root) : options.brainRoot ? basename(options.brainRoot) === ".edu" ? dirname(options.brainRoot) : options.brainRoot : process.cwd());
  return {
    async dispatch(input) {
      if (!input.task.trim()) throw new Error("Crew task must not be empty");
      const boundary = await realpath(workspaceRoot);
      const cwd = await realpath(resolve2(input.cwd ?? workspaceRoot));
      const fromBoundary = relative(boundary, cwd);
      if (fromBoundary === ".." || fromBoundary.startsWith(`..${sep}`) || isAbsolute(fromBoundary)) {
        throw new Error(`Crew dispatch cwd is outside the workspace: ${input.cwd ?? cwd}`);
      }
      const requestedMode = input.mode ?? "headless";
      const availablePane = requestedMode === "pane" && await herdrAvailable(options.herdr);
      const job = await store.create({ cli: input.cli, task: input.task.trim(), mode: availablePane ? "pane" : "headless", cwd, autonomy: input.autonomy ?? "ask" });
      if (requestedMode === "pane" && !availablePane) await store.update(job.id, { note: "Herdr unavailable; dispatched as headless." });
      if (availablePane) return dispatchPane(job, { ...options.herdr, store, brainRoot: root });
      return (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root });
    },
    async status(jobId) {
      if (jobId) {
        const job = await store.get(jobId);
        if (!job) throw new Error(`Crew job not found: ${jobId}`);
        return job.mode === "pane" ? refreshPane(job, { ...options.herdr, store, brainRoot: root }) : job;
      }
      const jobs = await store.list();
      return Promise.all(jobs.map((job) => job.mode === "pane" ? refreshPane(job, { ...options.herdr, store, brainRoot: root }) : job));
    },
    async result(jobId, waitSeconds = 0) {
      if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error("waitSeconds must be a non-negative number");
      const deadline = clock() + Math.floor(waitSeconds * 1e3);
      while (true) {
        const current = await this.status(jobId);
        if (["done", "failed", "cancelled"].includes(current.status) || clock() >= deadline) return current;
        await sleep(Math.min(250, Math.max(1, deadline - clock())));
      }
    },
    async review(input = {}) {
      const available = await detect();
      const callerEnv = options.callerEnv ?? process.env;
      const caller = input.callerCli ?? (callerEnv.ANTIGRAVITY || callerEnv.ANTIGRAVITY_AGENT || callerEnv.GEMINI_CLI ? "agy" : void 0);
      const reviewer = input.cli ?? available.find((cli) => cli !== caller);
      if (!reviewer || !available.includes(reviewer)) throw new Error("No available reviewer CLI different from the caller; specify an installed --cli");
      const base = input.base ?? "HEAD";
      const rawDiff = await (options.diff ?? defaultDiff)(base, process.cwd());
      const prompt = `Review the following changes. Do not modify files. Return concrete findings first, then residual risks.

\`\`\`diff
${truncateToTokens(rawDiff, 6e3)}
\`\`\``;
      let summary = "";
      for await (const event of engineFactory(reviewer).run({ cli: reviewer, prompt, cwd: process.cwd(), autonomy: "readonly", systemPrompt: "You are an independent, read-only code reviewer. Never request write access." }, `review-${Date.now()}`)) {
        if (event.type === "agent.text") summary += event.text;
        else if (event.type === "agent.end" || event.type === "run.end") {
          if (!event.ok) throw new Error("reviewer ended unsuccessfully");
          if (event.summary) summary = event.summary;
        } else if (event.type === "error") throw new Error(`Crew review failed: ${event.message}`);
      }
      return { cli: reviewer, summary: summary.trim() || "Reviewer returned no findings." };
    },
    runWorker: (jobId) => runWorker(jobId, { brainRoot: root, locations: options.locations, store, engineFactory }),
    store
  };
}
async function defaultDiff(base, cwd) {
  const result = await execFile2("git", ["diff", base, "--"], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
}
var defaultCrew = createCrew();

export {
  runWorker,
  createCrew
};
//# sourceMappingURL=chunk-DIW75Q6I.js.map