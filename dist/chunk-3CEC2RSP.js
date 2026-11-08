import {
  atomicWrite
} from "./chunk-2P2KBRRT.js";

// src/brain/auto-maintain.ts
import { access, readFile } from "fs/promises";
import { join } from "path";
var AUTO_MAINTAIN_INTERVAL_MS = 10 * 60 * 1e3;
async function consolidate(brain, root, now) {
  if (!brain.read || !brain.list || !brain.write || !brain.proposeCanonical) return void 0;
  try {
    await access(join(root, "reflect-queue"));
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw error;
  }
  let result;
  try {
    const { consolidatePending } = await import("./consolidate-5SA4U232.js");
    const report = await consolidatePending(brain, root, { now, maxEntries: 20, maxInterventions: 50 });
    result = { lessons: report.lessons.length, acknowledged: report.acknowledged.length, skipped: report.skipped.length, busy: report.busy };
  } catch (error) {
    result = { lessons: 0, acknowledged: 0, skipped: 0, busy: false, error: error instanceof Error ? error.message : String(error) };
  }
  await atomicWrite(join(root, "state", "consolidation.json"), `${JSON.stringify({ at: now.toISOString(), ...result }, null, 2)}
`);
  return result;
}
var maintainStatePath = (root) => join(root, "state", "maintain.json");
var count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
async function readMaintainState(root) {
  try {
    const raw = JSON.parse(await readFile(maintainStatePath(root), "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw;
    if (typeof value.lastRun !== "number" || !Number.isFinite(value.lastRun)) return null;
    return { lastRun: value.lastRun, promoted: count(value.promoted), retired: count(value.retired), overdue: count(value.overdue), changed: count(value.changed) };
  } catch {
    return null;
  }
}
async function autoMaintain(brain, root, opts = {}) {
  let consolidation;
  try {
    const now = opts.now ?? /* @__PURE__ */ new Date();
    if (opts.consolidate !== false) consolidation = await consolidate(brain, root, now);
    const extra = consolidation ? { consolidation } : {};
    if (!opts.force) {
      const previous = await readMaintainState(root);
      if (previous && now.getTime() - previous.lastRun < AUTO_MAINTAIN_INTERVAL_MS && now.getTime() >= previous.lastRun) return { ran: false, reason: "throttled", ...extra };
    }
    const report = await brain.maintain(now);
    const state = { lastRun: now.getTime(), promoted: report.promoted.length, retired: report.retired.length, overdue: report.overdue.length, changed: report.changed.length };
    await atomicWrite(maintainStatePath(root), `${JSON.stringify(state, null, 2)}
`);
    return { ran: true, report, state, ...extra };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error), ...consolidation ? { consolidation } : {} };
  }
}

export {
  AUTO_MAINTAIN_INTERVAL_MS,
  maintainStatePath,
  readMaintainState,
  autoMaintain
};
//# sourceMappingURL=chunk-3CEC2RSP.js.map