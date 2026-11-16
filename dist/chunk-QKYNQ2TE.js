import {
  isCrewJobStatus,
  isTerminalCrewJobStatus
} from "./chunk-X4DEIY6R.js";
import {
  retryFs
} from "./chunk-AINX4RRX.js";
import {
  processAlive
} from "./chunk-CAQVQMTA.js";
import {
  sumUsage
} from "./chunk-6GXTQRCF.js";
import {
  LOCAL_DIR,
  atomicWrite,
  ensureLocalIgnored,
  exclusiveWrite,
  folderKey,
  isAlreadyExists
} from "./chunk-YINGR2DA.js";

// src/crew/store.ts
import { appendFile as appendFile2, mkdir as mkdir2, readFile, readdir, rename, rm, stat, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join as join2, resolve } from "path";

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
    let result = "";
    for (const char of chunk) {
      if (char === "\n") {
        result += this.completeLine(this.pending + "\n");
        this.pending = "";
        this.droppingLongLine = false;
      } else if (!this.droppingLongLine) {
        this.pending += char;
        if (this.pending.length > MAX_PENDING_LINE) {
          result += "[long output line withheld for privacy]\n";
          this.pending = "";
          this.droppingLongLine = true;
        }
      }
    }
    return result;
  }
  flush() {
    const result = this.droppingLongLine ? "" : this.completeLine(this.pending);
    this.pending = "";
    this.droppingLongLine = false;
    return result;
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
function isCrewWorker(env = process.env) {
  return Boolean(env.EDU_CREW_JOB?.trim() || env.ALBERT_CREW_JOB?.trim());
}
function approvalDir(globalRoot, brainRoot, platform = process.platform) {
  return join2(resolve(globalRoot), LOCAL_DIR, "approvals", folderKey(brainRoot, platform));
}
var envGlobalRoot = () => resolve(process.env.EDU_HOME || join2(process.env.HOME || process.env.USERPROFILE || homedir(), ".edu"));
var DECISION_BY = /* @__PURE__ */ new Set(["cli", "deck", "host-llm"]);
var LOCK_WAIT_MS = 1e4;
var LOCK_STALE_MS = 3e4;
var STALE_DECISION_LOCK_MS = 3e4;
var pause = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
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
function createCrewStore(brainRoot, options = {}) {
  const root = join2(brainRoot, "crew");
  let gates;
  const gateDir = () => gates ??= approvalDir(options.globalRoot ?? envGlobalRoot(), brainRoot);
  const globalHome = () => resolve(options.globalRoot ?? envGlobalRoot());
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
  const decisionPath = (id) => join2(gateDir(), `${safeId(id)}.decision`);
  const gatePath = (id) => join2(gateDir(), `${safeId(id)}.gate.json`);
  const workspaceDecision = (id) => join2(root, `${safeId(id)}.decision`);
  const lockPath = (id) => join2(root, `${safeId(id)}.lock`);
  const ensure = () => mkdir2(root, { recursive: true });
  const removeFile = (path) => unlink(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  async function atomicJson(path, value) {
    await ensure();
    await atomicWrite(path, `${JSON.stringify(value, null, 2)}
`);
  }
  async function readGate(id) {
    let value;
    try {
      value = JSON.parse(await readFile(gatePath(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return void 0;
      throw error;
    }
    const gate = value && typeof value === "object" ? value : {};
    if (typeof gate.requestId !== "string" || typeof gate.openedAt !== "string" || typeof gate.title !== "string") return void 0;
    const checks = Array.isArray(gate.unregisteredChecks) ? gate.unregisteredChecks.filter((check) => typeof check === "string") : [];
    return { requestId: gate.requestId, openedAt: gate.openedAt, title: gate.title, ...checks.length ? { unregisteredChecks: checks } : {} };
  }
  async function closeGate(id) {
    await removeFile(gatePath(id));
    await removeFile(decisionPath(id));
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
      let job;
      try {
        job = JSON.parse(await readFile(metaPath(id), "utf8"));
        if (!job || typeof job !== "object" || !("id" in job) || !("status" in job) || !isCrewJobStatus(job.status)) throw new Error(`Invalid crew job record: ${id}`);
      } catch (error) {
        if (error.code === "ENOENT") return void 0;
        throw error;
      }
      const record = job;
      if (record.status !== "awaiting-approval") return record;
      const gate = await readGate(safeId(record.id));
      return { ...record, approval: gate };
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
        if (isTerminalCrewJobStatus(updated.status)) delete updated.approval;
        await atomicJson(metaPath(current.id), updated);
        if (current.status === "awaiting-approval" && isTerminalCrewJobStatus(updated.status)) await closeGate(current.id).catch(() => void 0);
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
      await closeGate(job.id);
      await removeFile(workspaceDecision(job.id));
      const approval = { requestId: randomUUID(), openedAt: (/* @__PURE__ */ new Date()).toISOString(), title: gate.title, ...gate.unregisteredChecks?.length ? { unregisteredChecks: gate.unregisteredChecks } : {} };
      await mkdir2(gateDir(), { recursive: true });
      await ensureLocalIgnored(globalHome());
      await atomicWrite(gatePath(job.id), `${JSON.stringify(approval)}
`);
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
      try {
        await exclusiveWrite(decisionPath(job.id), `${JSON.stringify(decision)}
`);
      } catch (error) {
        if (isAlreadyExists(error)) throw new Error(`A decision for this gate is already pending (job ${job.id.slice(0, 8)}); the worker applies it in a moment.`);
        throw error;
      }
    },
    async takeDecision(id) {
      const job = await this.get(id);
      if (!job) throw new Error(`Crew job not found: ${id}`);
      const gate = await readGate(job.id);
      const path = decisionPath(job.id);
      const lock = `${path}.lock`;
      try {
        await mkdir2(lock);
      } catch (error) {
        const code = error.code;
        if (code === "ENOENT") return void 0;
        if (code !== "EEXIST") throw error;
        const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0);
        if (age > STALE_DECISION_LOCK_MS) await rm(lock, { recursive: true, force: true }).catch(() => void 0);
        return void 0;
      }
      let text;
      try {
        const claimed = `${path}.${randomUUID()}.taking`;
        try {
          await retryFs.rename(path, claimed);
        } catch (error) {
          if (error.code === "ENOENT") return void 0;
          throw error;
        }
        try {
          text = await readFile(claimed, "utf8");
        } finally {
          await unlink(claimed).catch(() => void 0);
        }
      } finally {
        await rm(lock, { recursive: true, force: true }).catch(() => void 0);
      }
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        value = void 0;
      }
      const decision = value && typeof value === "object" ? value : {};
      const valid = gate !== void 0 && decision.requestId === gate.requestId && typeof decision.approve === "boolean" && DECISION_BY.has(decision.by) && typeof decision.at === "string" && Date.parse(decision.at) >= Date.parse(gate.openedAt);
      if (!valid) return void 0;
      await closeGate(job.id);
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

export {
  redactWorkerOutput,
  isCrewWorker,
  approvalDir,
  createCrewStore
};
//# sourceMappingURL=chunk-QKYNQ2TE.js.map