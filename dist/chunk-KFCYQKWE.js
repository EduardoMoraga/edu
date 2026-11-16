import {
  isCrewJobStatus,
  isTerminalCrewJobStatus
} from "./chunk-GCKZZJ4W.js";
import {
  runSession
} from "./chunk-5PXHEX27.js";
import {
  retryFs
} from "./chunk-AINX4RRX.js";
import {
  createEngine,
  detectEngines,
  enforcesReadonly,
  interactiveAutonomyFlags
} from "./chunk-BE3HXCZV.js";
import {
  describeProcess,
  killTree,
  processAlive
} from "./chunk-B7KZAX6U.js";
import {
  measuredEngine
} from "./chunk-5G4RNW33.js";
import {
  sumUsage
} from "./chunk-6GXTQRCF.js";
import {
  childEnv
} from "./chunk-6O2RRLWR.js";
import {
  binaryOnPath
} from "./chunk-KLV4TDB7.js";
import {
  openBrain
} from "./chunk-SOBMA5SW.js";
import {
  brief
} from "./chunk-RPDI7AOO.js";
import {
  truncateToTokens
} from "./chunk-ICQNXX6J.js";
import {
  atomicWrite,
  exclusiveWrite
} from "./chunk-KVVJCXPU.js";
import {
  CLI_IDS
} from "./chunk-X74ZO2KX.js";

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
import { appendFile as appendFile2, mkdir as mkdir2, readFile, readdir, rename, rm, stat, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join as join2 } from "path";
function isCrewWorker(env = process.env) {
  return Boolean(env.EDU_CREW_JOB?.trim() || env.ALBERT_CREW_JOB?.trim());
}
var DECISION_BY = /* @__PURE__ */ new Set(["cli", "deck", "host-llm"]);
var LOCK_WAIT_MS = 1e4;
var LOCK_STALE_MS = 3e4;
var pause = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
async function withJobLock(dir, body) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (; ; ) {
    try {
      await mkdir2(dir);
      await writeFile(join2(dir, "owner"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (await staleLock(dir)) {
      const claimed = `${dir}.stale-${process.pid}-${randomUUID()}`;
      try {
        await rename(dir, claimed);
        await rm(claimed, { recursive: true, force: true });
      } catch {
      }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the crew job lock: ${dir}`);
    await pause(10);
  }
  try {
    return await body();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function staleLock(dir) {
  try {
    const age = Date.now() - (await stat(dir)).mtimeMs;
    const owner = Number((await readFile(join2(dir, "owner"), "utf8").catch(() => "")).trim());
    if (Number.isInteger(owner) && owner > 0) return !processAlive(owner) || age > LOCK_STALE_MS;
    return age > 2e3;
  } catch {
    return false;
  }
}
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
  const lockPath = (id) => join2(root, `${safeId(id)}.lock`);
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
        if (!job || typeof job !== "object" || !("id" in job) || !("status" in job) || !isCrewJobStatus(job.status)) throw new Error(`Invalid crew job record: ${id}`);
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
      return this.mutate(id, () => patch);
    },
    async mutate(id, change) {
      const found = await this.get(id);
      if (!found) throw new Error(`Crew job not found: ${id}`);
      await ensure();
      return withJobLock(lockPath(found.id), async () => {
        const current = await this.get(found.id);
        if (!current) throw new Error(`Crew job not found: ${id}`);
        const patch = change(current);
        if (!patch) return current;
        if (patch.status && !isCrewJobStatus(patch.status)) throw new Error(`Invalid crew job status: ${patch.status}`);
        if (patch.status !== void 0 && patch.status !== current.status && isTerminalCrewJobStatus(current.status)) return current;
        const safePatch = { ...patch };
        try {
          if (isTerminalCrewJobStatus(patch.status)) await flushOutput(current.id);
          if (typeof patch.summary === "string") {
            await artifacts.replace(current.id, "summary", patch.summary);
            safePatch.summary = boundedWorkerPreview(redactWorkerOutput(patch.summary), current.id);
          }
        } catch {
          safePatch.summary = "[summary unavailable: artifact persistence failed]";
          if (!isTerminalCrewJobStatus(current.status)) {
            safePatch.status = "failed";
            safePatch.endedAt ??= (/* @__PURE__ */ new Date()).toISOString();
          }
        }
        if (typeof patch.note === "string") safePatch.note = redactWorkerOutput(patch.note);
        const updated = { ...current, ...safePatch };
        await atomicJson(metaPath(current.id), updated);
        return updated;
      });
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
    async openApproval(id, gate, patch = {}) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      await unlink(decisionPath(job.id)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      const approval = { requestId: randomUUID(), openedAt: (/* @__PURE__ */ new Date()).toISOString(), title: gate.title, ...gate.unregisteredChecks?.length ? { unregisteredChecks: gate.unregisteredChecks } : {} };
      return this.update(job.id, { ...patch, status: "awaiting-approval", approval });
    },
    async decide(id, approve, input) {
      if (isCrewWorker(input.env ?? process.env)) throw new Error("A crew worker cannot approve or reject crew jobs");
      if (!DECISION_BY.has(input.by)) throw new Error(`Invalid approval channel: ${String(input.by)}`);
      const job = await this.get(id);
      if (!job || job.kind !== "orchestration") throw new Error(`Orchestration job not found: ${id}`);
      if (job.status !== "awaiting-approval" || !job.approval) throw new Error(`Crew job is not awaiting approval: ${id}`);
      if (input.requestId !== job.approval.requestId) throw new Error(`Approval request ${input.requestId} is not the one job ${job.id.slice(0, 8)} is waiting on; read the current requestId with edu crew status`);
      const decision = { requestId: input.requestId, approve, by: input.by, at: (/* @__PURE__ */ new Date()).toISOString() };
      await exclusiveWrite(decisionPath(job.id), `${JSON.stringify(decision)}
`);
    },
    async takeDecision(id) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      const path = decisionPath(job.id);
      const claimed = `${path}.${randomUUID()}.taking`;
      try {
        await retryFs.rename(path, claimed);
      } catch (error) {
        if (error.code === "ENOENT") return void 0;
        throw error;
      }
      let text;
      try {
        text = await readFile(claimed, "utf8");
      } finally {
        await unlink(claimed).catch(() => void 0);
      }
      const gate = job.status === "awaiting-approval" ? job.approval : void 0;
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        value = void 0;
      }
      const decision = value && typeof value === "object" ? value : {};
      const valid = gate !== void 0 && decision.requestId === gate.requestId && typeof decision.approve === "boolean" && DECISION_BY.has(decision.by) && typeof decision.at === "string" && Date.parse(decision.at) >= Date.parse(gate.openedAt);
      if (!valid) return void 0;
      await this.update(job.id, { status: "running", approval: void 0 });
      return { approve: decision.approve, by: decision.by };
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
    const host = { available, env: { ...process.env, EDU_HOME: options.brainRoot }, home: dirname(options.brainRoot) };
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
      approve: async () => {
        if (job.autoApprove) return true;
        while (true) {
          const decision = await store.takeDecision(job.id);
          if (decision !== void 0) return { approved: decision.approve, by: decision.by };
          await sleep(250);
        }
      }
    });
    return await store.update(job.id, { ...specPatch(), status: result2.ok ? "done" : "failed", endedAt: now().toISOString(), summary: result2.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.appendEvent(job.id, { type: "error", message, at: now().toISOString() }).catch(() => void 0);
    return store.update(job.id, { ...specPatch(), status: "failed", endedAt: now().toISOString(), summary: message });
  }
}

// src/crew/headless.ts
var DEFAULT_CREW_TIMEOUT_MINUTES = 60;
function workerEnv(job, root, options = {}) {
  const platform = options.platform ?? process.platform;
  const source = { ...options.source ?? process.env, EDU_HOME: root };
  const env = {};
  for (const cli of job.kind === "orchestration" ? CLI_IDS : [job.cli]) Object.assign(env, childEnv(cli, {}, { source, platform }));
  const ownNeed = (name) => {
    const key = platform === "win32" ? name.toUpperCase() : name;
    return key.startsWith("NODE_") || key === "EDU_CREW_JOB" || key === "ALBERT_CREW_JOB";
  };
  for (const [name, value] of Object.entries(source)) if (value !== void 0 && ownNeed(name)) env[name] = value;
  return env;
}
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
      env: workerEnv(job, root),
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
  const timeoutMinutes = job.timeoutMinutes ?? DEFAULT_CREW_TIMEOUT_MINUTES;
  const deadline = new AbortController();
  let timer;
  try {
    const started = await store.update(job.id, { status: "running", pid: process.pid, note: void 0 });
    if (started.status !== "running") return started;
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
import { createHash } from "crypto";
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
    const unchanged = job.promptPaneHash !== void 0 && createHash("sha256").update(output.stdout).digest("hex") === job.promptPaneHash;
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
var OVERDUE_GRACE_MS = 5 * 6e4;
async function configuredTimeout(root) {
  try {
    const { loadConfig } = await import("./config-IKP7WT5U.js");
    return (await loadConfig(join4(root, "config.json"))).crew?.timeoutMinutes;
  } catch {
    return void 0;
  }
}
function validTimeout(minutes) {
  if (minutes === void 0) return void 0;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Crew timeout must be a whole number of minutes from 1 to 1440");
  return minutes;
}
function isWorkerOf(description, jobId, platform = process.platform) {
  if (!description) return false;
  return platform === "win32" ? /^node(?:\.exe)?$/i.test(description.trim()) : description.includes("crew") && description.includes(jobId);
}
function createCrew(options = {}) {
  const root = options.brainRoot ?? options.locations?.[0]?.root ?? defaultRoot();
  const store = options.store ?? createCrewStore(root);
  const engineFactory = options.engineFactory ?? createEngine;
  const detect = options.detectClis ?? detectEngines;
  const sleep = options.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const clock = options.clock ?? Date.now;
  const isAlive = options.isAlive ?? processAlive;
  const describe = options.describeProcess ?? describeProcess;
  const stop = options.stopProcess ?? ((pid, signal) => killTree({ pid }, signal));
  const readonlyEnforced = (cli) => measuredEngine(engineFactory(cli)).capabilities?.readonly === "enforced";
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
  const refresh = (job) => job.mode === "pane" ? refreshPane(job, { ...options.herdr, store, brainRoot: root }) : sweep(job);
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
      const job = await store.create({ cli, task: input.goal.trim(), goal: input.goal.trim(), kind: "orchestration", mode: "headless", cwd, autonomy: "auto", orchestrationMode: input.mode, playbook: input.playbook, harnessLevel: input.harnessLevel, autoApprove: input.autoApprove, allowUnregisteredChecks: input.allowUnregisteredChecks });
      await store.update(job.id, { status: "running" });
      try {
        return await (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root });
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
      const timeoutMinutes = validTimeout(input.timeoutMinutes) ?? validTimeout(options.timeoutMinutes) ?? await configuredTimeout(root) ?? DEFAULT_CREW_TIMEOUT_MINUTES;
      const requestedMode = input.mode ?? "headless";
      const target = requestedMode === "pane" ? await herdrTarget(options.herdr) : void 0;
      const pane = target !== void 0 && target.kind !== "none";
      const job = await store.create({ cli: input.cli, task: input.task.trim(), mode: pane ? "pane" : "headless", cwd, autonomy, timeoutMinutes });
      if (target?.kind === "none") await store.update(job.id, { note: `Herdr unavailable (${target.reason}); dispatched as headless.` });
      if (pane) return dispatchPane(job, { ...options.herdr, store, brainRoot: root, target });
      return (options.startHeadless ?? dispatchHeadless)(job, { brainRoot: root });
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
var cancel = (jobId) => defaultCrew.cancel(jobId);

export {
  isCrewWorker,
  createCrewStore,
  DEFAULT_CREW_TIMEOUT_MINUTES,
  runWorker,
  isWorkerOf,
  createCrew,
  dispatch,
  status,
  result,
  review,
  cancel
};
//# sourceMappingURL=chunk-KFCYQKWE.js.map