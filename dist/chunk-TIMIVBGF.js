import {
  executeRun
} from "./chunk-BYO2PQ3H.js";
import {
  processContext
} from "./chunk-VXRMRQCF.js";
import {
  brief
} from "./chunk-RHUHDDSE.js";
import {
  truncateToTokens
} from "./chunk-D45JK3LN.js";
import {
  binaryOnPath
} from "./chunk-HITNXL4T.js";
import {
  openBrain
} from "./chunk-K7L3WODK.js";
import {
  createEngine,
  detectEngines
} from "./chunk-JP6AHW2T.js";
import {
  measuredEngine
} from "./chunk-5G4RNW33.js";
import {
  sumUsage
} from "./chunk-6GXTQRCF.js";
import {
  atomicWrite
} from "./chunk-Z4O66FDA.js";

// src/crew/index.ts
import { execFile as execFileCallback2 } from "child_process";
import { promisify as promisify2 } from "util";
import { homedir as homedir2 } from "os";
import { realpath } from "fs/promises";
import { basename, dirname as dirname2, isAbsolute, join as join4, relative, resolve as resolve2, sep } from "path";

// src/crew/headless.ts
import { open as open2, mkdir as mkdir3 } from "fs/promises";
import { homedir } from "os";
import { join as join3, resolve } from "path";
import { spawn } from "child_process";

// src/context/artifacts.ts
import { appendFile, mkdir, open } from "fs/promises";
import { join } from "path";
var ID = /^[a-f0-9-]{36}$/i;
var MAX_PAGE_BYTES = 4096;
var MAX_PREVIEW_CHARS = 1200;
var MAX_PENDING_LINE = 8192;
var WorkerOutputFilter = class {
  pending = "";
  inPrivateKey = false;
  droppingLongLine = false;
  push(chunk) {
    let result2 = "";
    for (const char of chunk) {
      if (char === "\n") {
        result2 += this.completeLine(this.pending + "\n");
        this.pending = "";
        this.droppingLongLine = false;
      } else if (!this.droppingLongLine) {
        this.pending += char;
        if (this.pending.length > MAX_PENDING_LINE) {
          result2 += "[long output line withheld for privacy]\n";
          this.pending = "";
          this.droppingLongLine = true;
        }
      }
    }
    return result2;
  }
  flush() {
    const result2 = this.droppingLongLine ? "" : this.completeLine(this.pending);
    this.pending = "";
    this.droppingLongLine = false;
    return result2;
  }
  completeLine(line) {
    if (!line) return "";
    if (this.inPrivateKey) {
      if (/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) this.inPrivateKey = false;
      return "";
    }
    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) {
      this.inPrivateKey = !/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(line);
      return "[REDACTED PRIVATE KEY]\n";
    }
    return redactWorkerOutput(line);
  }
};
function validateArtifactJobId(id) {
  if (!ID.test(id)) throw new Error("Invalid crew artifact job id");
  return id.toLowerCase();
}
function redactWorkerOutput(value) {
  let text = value.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]").replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, "$1[REDACTED]").replace(/(?<![A-Za-z0-9])([A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret|secret_access_key)[A-Za-z0-9_]*(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s"',;}]*/gi, "$1[REDACTED]").replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|xox[bp]-[A-Za-z0-9-]{12,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[REDACTED TOKEN]").replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:)[^\s/@]+(@)/gi, "$1[REDACTED]$2");
  for (const [name, secret] of Object.entries(process.env)) {
    if (!/(?:KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)$/i.test(name) || !secret || secret.length < 8) continue;
    text = text.replaceAll(secret, "[REDACTED ENV VALUE]");
  }
  return text;
}
function boundedWorkerPreview(safeText, jobId) {
  if (safeText.length <= MAX_PREVIEW_CHARS) return safeText;
  return `${safeText.slice(0, MAX_PREVIEW_CHARS)}
[truncated; full sanitized summary: edu_crew_artifact jobId=${jobId} kind=summary]`;
}
function createCrewArtifacts(brainRoot) {
  const directory = join(brainRoot, "crew", "artifacts");
  const pathFor = (id, kind) => {
    if (kind !== "output" && kind !== "summary") throw new Error("Invalid crew artifact kind");
    return join(directory, `${validateArtifactJobId(id)}.${kind}.txt`);
  };
  return {
    async replace(id, kind, raw) {
      await mkdir(directory, { recursive: true, mode: 448 });
      await atomicWrite(pathFor(id, kind), redactWorkerOutput(raw));
    },
    async append(id, kind, raw) {
      await mkdir(directory, { recursive: true, mode: 448 });
      await appendFile(pathFor(id, kind), redactWorkerOutput(raw), { encoding: "utf8", mode: 384 });
    },
    async read(id, kind, offset = 0, maxBytes = 2048) {
      const jobId = validateArtifactJobId(id);
      if (kind !== "output" && kind !== "summary") throw new Error("Invalid crew artifact kind");
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Artifact offset must be a non-negative integer");
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PAGE_BYTES) throw new Error(`Artifact maxBytes must be between 1 and ${MAX_PAGE_BYTES}`);
      const handle = await open(pathFor(jobId, kind), "r");
      try {
        const totalBytes = (await handle.stat()).size;
        if (offset > totalBytes) throw new Error("Artifact offset exceeds file length");
        if (offset > 0 && offset < totalBytes) {
          const first = Buffer.alloc(1);
          await handle.read(first, 0, 1, offset);
          if ((first[0] & 192) === 128) throw new Error("Artifact offset is inside a UTF-8 character");
        }
        const bytes = Buffer.alloc(Math.min(maxBytes + 4, totalBytes - offset));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
        let end = Math.min(maxBytes, bytesRead);
        if (offset + end < totalBytes) {
          while (end > 0 && (bytes[end] & 192) === 128) end--;
          if (end === 0) throw new Error("Artifact page size is too small for a UTF-8 character");
        }
        const nextOffset = offset + end < totalBytes ? offset + end : null;
        return { jobId, kind, offset, nextOffset, totalBytes, text: bytes.subarray(0, end).toString("utf8"), truncated: nextOffset !== null };
      } finally {
        await handle.close();
      }
    }
  };
}

// src/crew/store.ts
import { appendFile as appendFile2, mkdir as mkdir2, readFile, readdir, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join as join2 } from "path";
var statuses = /* @__PURE__ */ new Set(["queued", "running", "awaiting-approval", "done", "failed", "cancelled"]);
var safeId = (id) => {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`Invalid crew job id: ${id}`);
  return id;
};
function createCrewStore(brainRoot) {
  const root = join2(brainRoot, "crew");
  const artifacts = createCrewArtifacts(brainRoot);
  const outputFilters = /* @__PURE__ */ new Map();
  const filterFor = (id) => {
    let filter = outputFilters.get(id);
    if (!filter) {
      filter = new WorkerOutputFilter();
      outputFilters.set(id, filter);
    }
    return filter;
  };
  const flushOutput = async (id) => {
    const filter = outputFilters.get(id);
    if (!filter) return;
    const safe = filter.flush();
    if (safe) await artifacts.append(id, "output", safe);
    outputFilters.delete(id);
  };
  const metaPath = (id) => join2(root, `${safeId(id)}.json`);
  const eventPath = (id) => join2(root, `${safeId(id)}.jsonl`);
  const decisionPath = (id) => join2(root, `${safeId(id)}.decision`);
  const ensure = () => mkdir2(root, { recursive: true });
  async function atomicJson(path, value) {
    await ensure();
    await atomicWrite(path, `${JSON.stringify(value, null, 2)}
`);
  }
  return {
    async create(input) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const job = { ...input, task: redactWorkerOutput(input.task), goal: input.goal ? redactWorkerOutput(input.goal) : void 0, id: randomUUID(), status: "queued", createdAt: now, summary: "", usage: sumUsage([]) };
      await artifacts.replace(job.id, "output", "");
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
      const safePatch = { ...patch };
      try {
        if (patch.status && ["done", "failed", "cancelled"].includes(patch.status)) await flushOutput(current.id);
        if (typeof patch.summary === "string") {
          await artifacts.replace(current.id, "summary", patch.summary);
          safePatch.summary = boundedWorkerPreview(redactWorkerOutput(patch.summary), current.id);
        }
      } catch {
        safePatch.summary = "[summary unavailable: artifact persistence failed]";
        safePatch.status = "failed";
        safePatch.endedAt ??= (/* @__PURE__ */ new Date()).toISOString();
      }
      if (typeof patch.note === "string") safePatch.note = redactWorkerOutput(patch.note);
      const updated = { ...current, ...safePatch };
      await atomicJson(metaPath(id), updated);
      return updated;
    },
    async appendEvent(id, event) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      if (event.type === "agent.text") {
        const safe = filterFor(job.id).push(event.text);
        if (safe) await artifacts.append(job.id, "output", safe);
      } else if (event.type === "agent.end" || event.type === "run.end" || event.type === "error") {
        await flushOutput(job.id);
      }
      const structural = /* @__PURE__ */ new Set(["type", "at", "agentId", "runId", "approvalId", "noteId", "callId", "sessionId", "id"]);
      const safeEvent = JSON.parse(JSON.stringify(event, (key, value) => event.type === "agent.text" && key === "text" ? "[full stream in crew output artifact]" : value !== null && typeof value !== "number" && typeof value !== "boolean" && /(?:password|secret|token|api[_-]?key|credential)/i.test(key) ? "[REDACTED]" : typeof value === "string" && !structural.has(key) ? redactWorkerOutput(value) : value));
      await appendFile2(eventPath(job.id), `${JSON.stringify(safeEvent)}
`, "utf8");
    },
    async flushOutput(id) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      await flushOutput(job.id);
    },
    async events(id) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      const text = await readFile(eventPath(job.id), "utf8");
      return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    },
    async decide(id, approve) {
      const job = await this.get(id);
      if (!job || job.kind !== "orchestration") throw new Error(`Orchestration job not found: ${id}`);
      if (job.status !== "awaiting-approval") throw new Error(`Crew job is not awaiting approval: ${id}`);
      await writeFile(decisionPath(job.id), approve ? "approve" : "reject", { flag: "wx" });
    },
    async takeDecision(id) {
      const path = decisionPath(id);
      let value;
      try {
        value = await readFile(path, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return void 0;
        throw error;
      }
      if (value !== "approve" && value !== "reject") throw new Error(`Invalid approval decision for crew job: ${id}`);
      await this.update(id, { status: "running" });
      await unlink(path);
      return value === "approve";
    },
    async artifact(id, kind, offset, maxBytes) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      return artifacts.read(job.id, kind, offset, maxBytes);
    }
  };
}

// src/crew/orchestration.ts
import { dirname } from "path";
async function runOrchestration(job, options) {
  const { store } = options;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve3) => setTimeout(resolve3, ms)));
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
      await store.update(job.id, { ...specPatch(), status: "awaiting-approval" });
      await store.appendEvent(job.id, { type: "agent.status", agentId: job.id, status: "awaiting-approval", at: event.at });
    }
    await flushSpec();
    if (event.type === "approval.resolve") await store.update(job.id, { status: "running" });
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
    const context = processContext();
    context.cwd = job.cwd;
    context.env = { ...process.env, EDU_HOME: options.brainRoot };
    context.home = dirname(options.brainRoot);
    context.availableClis = available;
    context.engineFactory = options.engineFactory;
    await store.update(job.id, { status: "running", pid: process.pid });
    const result2 = await executeRun(context, {
      goal: job.goal ?? job.task,
      cwd: job.cwd,
      lang: "en",
      mode: job.orchestrationMode,
      cli: job.cli,
      harnessLevel: job.harnessLevel,
      playbook: job.playbook,
      autoApprove: job.autoApprove,
      engines: options.engineFactory,
      available,
      onEvent,
      approve: async () => {
        if (job.autoApprove) return true;
        while (true) {
          const decision = await store.takeDecision(job.id);
          if (decision !== void 0) return decision;
          await sleep(250);
        }
      }
    });
    return store.update(job.id, { ...specPatch(), status: result2.ok ? "done" : "failed", endedAt: now().toISOString(), summary: result2.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: "error", message, at: now().toISOString() }).catch(() => void 0);
    return store.update(job.id, { ...specPatch(), status: "failed", endedAt: now().toISOString(), summary: message });
  }
}

// src/crew/headless.ts
function defaultBrainRoot() {
  return resolve(process.env.EDU_HOME || join3(homedir(), ".edu"));
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
  const logDir = join3(root, "crew");
  await mkdir3(logDir, { recursive: true });
  const log = await open2(join3(logDir, `${job.id}.log`), "a");
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
    return store.update(job.id, { pid: child.pid });
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
  if (job.kind === "orchestration") return runOrchestration(job, { brainRoot: root, store, engineFactory: options.engineFactory, detectClis: options.detectClis, now: options.now, sleep: options.sleep });
  let summary = "";
  let usage = sumUsage([]);
  let failed = false;
  try {
    await store.update(job.id, { status: "running", pid: process.pid, note: void 0 });
    const brain = openBrain(locations);
    const context = await brief(brain, 1200, { eduMdPath: join3(locations[0].root, "EDU.md") });
    const engine = (options.engineFactory ?? createEngine)(job.cli);
    const systemPrompt = [
      "You are an Edu crew worker. Complete the user mission directly; no built-in role identity applies.",
      "Respect the requested autonomy and report a concise result, including blockers and verification.",
      context ? `
## Brain brief
${context}` : ""
    ].filter(Boolean).join("\n");
    for await (const event of measuredEngine(engine).run({ invocation: { id: crypto.randomUUID(), purpose: "task" }, cli: job.cli, prompt: job.task, cwd: job.cwd, autonomy: job.autonomy, systemPrompt }, job.id)) {
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
    return store.update(job.id, { status: "failed", endedAt: iso(now), summary: message, usage });
  }
}

// src/crew/herdr.ts
import { createHash } from "crypto";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
var execFile = promisify(execFileCallback);
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
  if (target.kind === "inside") {
    const split = parse((await runner(["pane", "split", "--current", "--direction", "right", "--cwd", job.cwd, "--no-focus"])).stdout);
    const pane2 = split.result?.pane;
    return typeof pane2?.pane_id === "string" ? pane2.pane_id : void 0;
  }
  const args = target.workspaceId ? ["tab", "create", "--workspace", target.workspaceId, "--cwd", job.cwd, "--label", agentName, "--no-focus"] : ["workspace", "create", "--cwd", job.cwd, "--label", EDU_WORKSPACE_LABEL, "--no-focus"];
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
    return store.update(job.id, { status: "running", paneId, agentName, note: where, ...await promptBaseline(agentName, paneId, options, now) });
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
    const { status: status2, seq } = await agentState(job.agentName, options);
    if (job.pendingPrompt) {
      if (status2 !== "idle" && status2 !== "done") return job;
      await (options.runner ?? defaultRunner)(["agent", "prompt", job.agentName, job.pendingPrompt]);
      return store.update(job.id, { pendingPrompt: void 0, note: void 0, ...await promptBaseline(job.agentName, job.paneId, options, options.now ?? (() => /* @__PURE__ */ new Date())) });
    }
    if (status2 === "working" || status2 === "blocked") {
      await appendPaneOutput(job, store, options);
      return job.observedWorking ? job : store.update(job.id, { observedWorking: true });
    }
    let changedSincePrompt = seq !== void 0 && job.promptSeq !== void 0 && seq > job.promptSeq;
    const settledFor = job.promptedAt ? (options.now ?? (() => /* @__PURE__ */ new Date()))().getTime() - Date.parse(job.promptedAt) : 0;
    if (!changedSincePrompt && status2 === "idle" && job.paneId && job.promptPaneHash && settledFor >= 5e3) {
      changedSincePrompt = await paneHash(job.paneId, options).catch(() => job.promptPaneHash) !== job.promptPaneHash;
    }
    if (status2 === "done" || status2 === "idle" && (job.observedWorking || changedSincePrompt)) {
      await appendPaneOutput(job, store, options);
      const output = await (options.runner ?? defaultRunner)(["agent", "read", job.agentName, "--source", "recent-unwrapped", "--lines", "200"]);
      return store.update(job.id, { status: "done", endedAt: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(), summary: readResult(output.stdout) });
    }
    if (status2 === "failed" || status2 === "error") {
      await appendPaneOutput(job, store, options);
      return store.update(job.id, { status: "failed", endedAt: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(), summary: `Herdr agent ${status2}` });
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
  if (lastPaneSnapshots.get(job.id) === text) return;
  await store.appendEvent(job.id, { type: "agent.text", agentId: job.id, text, at: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString() });
  lastPaneSnapshots.set(job.id, text);
}
var lastPaneSnapshots = /* @__PURE__ */ new Map();
async function agentState(name, options) {
  const raw = parse((await (options.runner ?? defaultRunner)(["agent", "get", name])).stdout);
  const result2 = raw.result;
  const agent = result2?.agent;
  const status2 = String(agent?.agent_status ?? agent?.status ?? agent?.state ?? result2?.agent_status ?? result2?.status ?? raw.status ?? "").toLowerCase();
  const seq = typeof agent?.state_change_seq === "number" ? agent.state_change_seq : void 0;
  return { status: status2, seq };
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
var defaultRoot = () => resolve2(process.env.EDU_HOME || join4(homedir2(), ".edu"));
function createCrew(options = {}) {
  const root = options.brainRoot ?? options.locations?.[0]?.root ?? defaultRoot();
  const store = options.store ?? createCrewStore(root);
  const engineFactory = options.engineFactory ?? createEngine;
  const detect = options.detectClis ?? detectEngines;
  const sleep = options.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const clock = options.clock ?? Date.now;
  const workspaceRoot = options.workspaceRoot ?? (options.locations?.find((loc) => loc.scope === "project")?.root ? dirname2(options.locations.find((loc) => loc.scope === "project").root) : options.brainRoot ? basename(options.brainRoot) === ".edu" ? dirname2(options.brainRoot) : options.brainRoot : process.cwd());
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
      const job = await store.create({ cli, task: input.goal.trim(), goal: input.goal.trim(), kind: "orchestration", mode: "headless", cwd, autonomy: "auto", orchestrationMode: input.mode, playbook: input.playbook, harnessLevel: input.harnessLevel, autoApprove: input.autoApprove });
      await store.update(job.id, { status: "running" });
      try {
        return await (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root });
      } catch (error) {
        await store.update(job.id, { status: "failed", endedAt: (/* @__PURE__ */ new Date()).toISOString(), summary: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    async approve(jobId, approved) {
      await store.decide(jobId, approved);
      return await store.get(jobId);
    },
    async dispatch(input) {
      if (!input.task.trim()) throw new Error("Crew task must not be empty");
      const boundary = await realpath(workspaceRoot);
      const cwd = await realpath(resolve2(input.cwd ?? workspaceRoot));
      const fromBoundary = relative(boundary, cwd);
      if (fromBoundary === ".." || fromBoundary.startsWith(`..${sep}`) || isAbsolute(fromBoundary)) {
        throw new Error(`Crew dispatch cwd is outside the workspace: ${input.cwd ?? cwd}`);
      }
      const requestedMode = input.mode ?? "headless";
      const target = requestedMode === "pane" ? await herdrTarget(options.herdr) : void 0;
      const pane = target !== void 0 && target.kind !== "none";
      const job = await store.create({ cli: input.cli, task: input.task.trim(), mode: pane ? "pane" : "headless", cwd, autonomy: input.autonomy ?? "ask" });
      if (target?.kind === "none") await store.update(job.id, { note: `Herdr unavailable (${target.reason}); dispatched as headless.` });
      if (pane) return dispatchPane(job, { ...options.herdr, store, brainRoot: root, target });
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
      const rawDiff = await (options.diff ?? defaultDiff)(base, workspaceRoot);
      const prompt = `Review the following changes. Do not modify files. Return concrete findings first, then residual risks.

\`\`\`diff
${truncateToTokens(rawDiff, 6e3)}
\`\`\``;
      let summary = "";
      for await (const event of measuredEngine(engineFactory(reviewer)).run({ invocation: { id: crypto.randomUUID(), purpose: "review" }, cli: reviewer, prompt, cwd: workspaceRoot, autonomy: "readonly", systemPrompt: "You are an independent, read-only code reviewer. Never request write access." }, `review-${Date.now()}`)) {
        if (event.type === "agent.text") summary += event.text;
        else if (event.type === "agent.end" || event.type === "run.end") {
          if (!event.ok) throw new Error("reviewer ended unsuccessfully");
          if (event.summary) summary = event.summary;
        } else if (event.type === "error") throw new Error(`Crew review failed: ${event.message}`);
      }
      return { cli: reviewer, summary: summary.trim() || "Reviewer returned no findings." };
    },
    runWorker: (jobId) => runWorker(jobId, { brainRoot: root, locations: options.locations, store, engineFactory, detectClis: detect, sleep }),
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

export {
  createCrewStore,
  runWorker,
  createCrew,
  dispatch,
  status,
  result,
  review
};
//# sourceMappingURL=chunk-TIMIVBGF.js.map