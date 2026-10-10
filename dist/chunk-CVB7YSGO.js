// src/tui/crew.ts
import { open, readFile, readdir } from "fs/promises";
import { join } from "path";
var STATUSES = /* @__PURE__ */ new Set(["queued", "running", "done", "failed", "cancelled"]);
var TERMINAL = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function fsCrewSource(brainRoot, refresh) {
  const dir = join(brainRoot, "crew");
  return {
    async list() {
      let files;
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      } catch {
        return [];
      }
      const jobs = await Promise.all(files.map(async (f) => {
        const path = join(dir, f);
        const job = await readJob(path);
        if (job?.mode !== "pane" || job.status !== "running" || !refresh) return job;
        await refresh(job.id).catch(() => void 0);
        return await readJob(path) ?? job;
      }));
      return jobs.filter((j) => j !== void 0);
    },
    async read(jobId, offset) {
      if (!/^[\w.-]+$/.test(jobId)) return { events: [], offset };
      return tail(join(dir, `${jobId}.jsonl`), offset);
    }
  };
}
async function readJob(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (!raw || typeof raw !== "object") return void 0;
    const job = raw;
    if (typeof job.id !== "string" || typeof job.status !== "string" || !STATUSES.has(job.status)) return void 0;
    return {
      id: job.id,
      cli: String(job.cli ?? "claude"),
      task: typeof job.task === "string" ? job.task : "",
      status: job.status,
      createdAt: typeof job.createdAt === "string" ? job.createdAt : void 0,
      endedAt: typeof job.endedAt === "string" ? job.endedAt : void 0,
      summary: typeof job.summary === "string" ? job.summary : void 0,
      mode: job.mode === "pane" ? "pane" : "headless"
    };
  } catch {
    return void 0;
  }
}
async function tail(path, offset) {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return { events: [], offset };
  }
  try {
    const { size } = await handle.stat();
    if (size <= offset) return { events: [], offset: Math.min(offset, size) };
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    const end = buffer.lastIndexOf(10);
    if (end < 0) return { events: [], offset };
    const events = [];
    for (const line of buffer.subarray(0, end).toString("utf8").split("\n")) {
      const event = parseEvent(line);
      if (event) events.push(event);
    }
    return { events, offset: offset + end + 1 };
  } finally {
    await handle.close();
  }
}
function parseEvent(line) {
  if (!line.trim()) return void 0;
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" && typeof value.type === "string" ? value : void 0;
  } catch {
    return void 0;
  }
}
async function* watchCrew(source, opts = {}) {
  const now = () => (opts.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const tracked = /* @__PURE__ */ new Map();
  yield { type: "run.start", runId: "crew-watch", goal: opts.jobId ? `crew job ${opts.jobId}` : "crew jobs", mode: "crew", at: now() };
  let warned = false;
  while (!opts.signal?.aborted) {
    const jobs = (await source.list()).filter((j) => !opts.jobId || j.id === opts.jobId || j.id.startsWith(opts.jobId)).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    if (opts.jobId && jobs.length === 0 && !warned) {
      warned = true;
      yield { type: "error", message: `no crew job matches ${opts.jobId}`, at: now() };
    }
    for (const job of jobs) {
      let t = tracked.get(job.id);
      if (!t) {
        t = { job, offset: 0, spawned: /* @__PURE__ */ new Set(), ended: false };
        tracked.set(job.id, t);
        const at = job.createdAt ?? now();
        yield { type: "agent.spawn", agentId: job.id, role: `${job.cli} ${job.id.slice(0, 6)}`, cli: job.cli, task: job.task, at };
        if (job.status !== "queued") yield { type: "agent.status", agentId: job.id, status: "running", at };
      } else if (t.job.status === "queued" && job.status !== "queued") {
        yield { type: "agent.status", agentId: job.id, status: "running", at: now() };
      }
      t.job = job;
      const chunk = await source.read(job.id, t.offset);
      t.offset = chunk.offset;
      for (const event of chunk.events) {
        const mapped = rehome(t, event);
        if (mapped) yield mapped;
      }
      if (TERMINAL.has(job.status) && !t.ended) {
        t.ended = true;
        const at = job.endedAt ?? now();
        if (job.status === "cancelled") yield { type: "agent.status", agentId: job.id, status: "cancelled", at };
        else yield { type: "agent.end", agentId: job.id, ok: job.status === "done", summary: job.summary ?? "", at };
      }
    }
    if (opts.follow === false) return;
    await sleep(opts.pollMs ?? 500, opts.signal);
  }
}
function rehome(t, event) {
  const jobId = t.job.id;
  const id = (agentId) => agentId && t.spawned.has(agentId) ? `${jobId}/${agentId}` : jobId;
  switch (event.type) {
    case "run.start":
    case "run.end":
    case "outcome":
    case "task.define":
    case "approval.request":
    case "approval.resolve":
      return void 0;
    case "agent.spawn":
      t.spawned.add(event.agentId);
      return { ...event, agentId: id(event.agentId), parentId: event.parentId && t.spawned.has(event.parentId) ? id(event.parentId) : jobId };
    case "agent.end":
      if (id(event.agentId) === jobId) t.ended = true;
      return { ...event, agentId: id(event.agentId) };
    case "agent.status":
    case "agent.text":
    case "agent.thinking":
    case "tool.call":
    case "tool.result":
    case "usage":
      return { ...event, agentId: id(event.agentId) };
    case "error":
    case "context.usage":
    case "brain.recall":
      return { ...event, agentId: id(event.agentId) };
    default:
      return event;
  }
}
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export {
  fsCrewSource,
  watchCrew
};
//# sourceMappingURL=chunk-CVB7YSGO.js.map