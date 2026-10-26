import {
  atomicWrite,
  createId
} from "./chunk-Z4O66FDA.js";

// src/reflect/consolidate.ts
import { randomUUID as randomUUID2 } from "crypto";
import { open, readdir, readFile as readFile2, unlink, rename, link as link2 } from "fs/promises";
import { join as join2 } from "path";
import { z } from "zod";

// src/reflect/persistence.ts
import { hostname } from "os";
import { createHash, randomUUID } from "crypto";
import { mkdir, realpath, rm, readFile, writeFile, link } from "fs/promises";
import { join } from "path";
var digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function claim(path, owner, depth = 0) {
  if (depth > 8) return void 0;
  const temporary = `${path}.${randomUUID()}.owner`;
  await writeFile(temporary, owner, { flag: "wx" });
  const release = async () => {
    try {
      if (await readFile(path, "utf8") === owner) await rm(path, { force: true });
    } catch {
    }
  };
  try {
    try {
      await link(temporary, path);
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let stale;
    try {
      stale = await readFile(path, "utf8");
    } catch {
      return void 0;
    }
    if (!deadOwner(stale)) return void 0;
    const releaseRecovery = await claim(`${path}.recovery`, owner, depth + 1);
    if (!releaseRecovery) return void 0;
    try {
      if (await readFile(path, "utf8").catch(() => "") !== stale || !deadOwner(stale)) return void 0;
      await rm(path);
      try {
        await link(temporary, path);
        return release;
      } catch (error) {
        if (error.code === "EEXIST") return void 0;
        throw error;
      }
    } finally {
      await releaseRecovery();
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {
    });
  }
}
function deadOwner(raw) {
  try {
    const owner = JSON.parse(raw);
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.host && owner.host !== hostname()) return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      return error.code === "ESRCH";
    }
  } catch {
    return false;
  }
}
async function locked(root, action) {
  await mkdir(root, { recursive: true });
  const path = join(await realpath(root), ".reflection.lock");
  const release = await claim(path, JSON.stringify({ pid: process.pid, host: hostname(), token: randomUUID(), startedAt: (/* @__PURE__ */ new Date()).toISOString() }));
  if (!release) return void 0;
  try {
    return await action();
  } finally {
    await release();
  }
}
var canonicalBody = (body) => body.replace(/\r\n?/g, "\n").trim();
async function writeOnce(brain, input, identity) {
  const body = canonicalBody(input.body);
  const links = [...new Set(input.links ?? [])].sort();
  const key = digest(identity ?? { kind: input.kind, tier: input.tier, title: input.title, body, links });
  const value = { ...input, body, links, title: `${input.title} [${key.slice(0, 24)}]` };
  const id = createId(value);
  const existing = await brain.read(id);
  if (existing) {
    if (canonicalBody(existing.body) !== body || existing.meta.source !== input.source || JSON.stringify([...existing.meta.links].sort()) !== JSON.stringify(links)) {
      throw new Error(`Reflection identity collision: ${id}`);
    }
    return { id, created: false, rejected: false };
  }
  const rejection = (await brain.list({ tier: "episodic" })).find((note) => note.meta.source === "edu:reject" && note.meta.links.includes(id));
  if (rejection) return { id, created: false, rejected: true };
  return { id: (await (input.tier === "canonical" ? brain.proposeCanonical(value) : brain.write(value))).meta.id, created: true, rejected: false };
}

// src/reflect/consolidate.ts
var safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
var QueueSchema = z.object({ runId: safeId, sessionId: safeId });
var InterventionSchema = z.object({
  type: z.literal("intervention"),
  by: z.literal("user"),
  avoidable: z.boolean(),
  harnessGap: z.enum(["context", "tool", "feedback", "verify", "recovery", "entropy", "model", "unknown"]),
  action: z.string().trim().min(1),
  detail: z.string().trim().min(1).optional()
});
function cutoff(since, now) {
  const match = /^([1-9]\d*)([dhm])$/.exec(since);
  if (!match) throw new Error(`Invalid since duration '${since}'; use 7d, 12h, or 30m.`);
  return new Date(now.getTime() - Number(match[1]) * (match[2] === "d" ? 864e5 : match[2] === "h" ? 36e5 : 6e4)).toISOString();
}
function bound(value, fallback, maximum) {
  if (value === void 0) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Limit must be an integer between 1 and ${maximum}`);
  return value;
}
async function boundedRead(path, maxBytes) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error("Reflection input exceeds byte limit");
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}
async function queueSnapshot(root, maxEntries = 50, maxBytes = 262144) {
  let files;
  try {
    files = await readdir(join2(root, "reflect-queue"), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = [];
  const cursorPath = join2(root, ".reflection-queue-cursor.json");
  let cursor = "";
  try {
    const value = JSON.parse(await boundedRead(cursorPath, 4096));
    if (typeof value.after === "string") cursor = value.after;
  } catch {
  }
  const sorted = files.filter((file) => file.isFile() && file.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...sorted.filter((file) => file.name.localeCompare(cursor) > 0), ...sorted.filter((file) => file.name.localeCompare(cursor) <= 0)].slice(0, maxEntries);
  for (const file of ordered) {
    try {
      const raw = await boundedRead(join2(root, "reflect-queue", file.name), maxBytes);
      const value = QueueSchema.parse(JSON.parse(raw));
      entries.push({ name: file.name, raw, ...value });
    } catch {
    }
  }
  const last = ordered.at(-1);
  if (last) await atomicWrite(cursorPath, JSON.stringify({ after: last.name }));
  return entries;
}
async function acknowledge(root, entry) {
  const path = join2(root, "reflect-queue", entry.name);
  const claimed = join2(root, "reflect-queue", `${randomUUID2()}.pending.json`);
  try {
    await rename(path, claimed);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (await readFile2(claimed, "utf8") === entry.raw) {
    await unlink(claimed);
    return true;
  }
  try {
    await link2(claimed, path);
    await unlink(claimed);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return false;
}
async function readInterventions(root, entry, maxBytes = 262144, maxInterventions = 200) {
  try {
    const dir = join2(root, "runs", entry.runId);
    const task = JSON.parse(await boundedRead(join2(dir, "task.json"), maxBytes));
    const outcome = JSON.parse(await boundedRead(join2(dir, "outcome.json"), maxBytes));
    if (task.runId !== entry.runId || !outcome || !["autonomous_verified_success", "assisted_verified_success", "unverified_success", "failed", "unsafe_invalid"].includes(outcome.label)) return void 0;
    const lines = (await boundedRead(join2(dir, "intervention.jsonl"), maxBytes)).split(/\r?\n/).filter((line) => line.trim());
    if (lines.length > maxInterventions) return void 0;
    const result = [];
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.type === "approval.resolve") continue;
      const parsed = InterventionSchema.safeParse(event);
      if (!parsed.success) return void 0;
      if (parsed.data.avoidable) {
        if (!parsed.data.detail) return void 0;
        result.push({ ...parsed.data, detail: parsed.data.detail, runId: entry.runId, sessionId: entry.sessionId });
      }
    }
    return result;
  } catch {
    return void 0;
  }
}
async function writeInterventions(brain, events) {
  const ids = /* @__PURE__ */ new Set();
  for (const event of events) {
    const result = await writeOnce(brain, {
      title: `Harness gap: ${event.harnessGap} \u2014 ${event.action}`,
      body: `Observed avoidable user intervention. This is candidate evidence, not a verified remedy.

Run: ${event.runId}
Action: ${event.action}
Evidence: ${event.detail}`,
      tier: "transitive",
      kind: "lesson",
      band: "inferred",
      tags: [`harness-gap:${event.harnessGap}`],
      links: [event.sessionId],
      source: "edu:reflect"
    }, { intervention: digest(event) });
    if (!result.rejected) ids.add(result.id);
  }
  return [...ids];
}
async function consolidatePending(brain, brainRoot, options = {}) {
  const maxEntries = bound(options.maxEntries, 50, 1e3);
  const maxInterventions = bound(options.maxInterventions, 200, 1e3);
  const maxBytes = bound(options.maxBytes, 262144, 1048576);
  const sinceAt = cutoff(options.since ?? "7d", options.now ?? /* @__PURE__ */ new Date());
  const report = { lessons: [], acknowledged: [], skipped: [], busy: false };
  return await locked(brainRoot, async () => {
    for (const entry of await queueSnapshot(brainRoot, maxEntries, maxBytes)) {
      const session = await brain.read(entry.sessionId);
      if (!session || session.meta.kind !== "session" || session.meta.status !== "closed" || (session.meta.updated ?? session.meta.created) < sinceAt) {
        report.skipped.push(entry.name);
        continue;
      }
      const events = await readInterventions(brainRoot, entry, maxBytes, maxInterventions);
      if (!events) {
        report.skipped.push(entry.name);
        continue;
      }
      report.lessons.push(...await writeInterventions(brain, events));
      if (await acknowledge(brainRoot, entry)) report.acknowledged.push(entry.name);
    }
    report.lessons = [...new Set(report.lessons)];
    return report;
  }) ?? { ...report, busy: true };
}

export {
  digest,
  locked,
  writeOnce,
  cutoff,
  boundedRead,
  queueSnapshot,
  acknowledge,
  readInterventions,
  writeInterventions,
  consolidatePending
};
//# sourceMappingURL=chunk-XH2WGRCC.js.map