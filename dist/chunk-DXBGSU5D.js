import {
  atomicWrite
} from "./chunk-TH5GRG3L.js";

// src/evidence/registry.ts
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
var ToolSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  description: z.string().optional(),
  timeoutMs: z.number().int().positive().optional()
}).strict();
var CheckSchema = z.object({
  id: z.string().min(1),
  requirementIds: z.array(z.string()),
  command: z.string().min(1),
  expect: z.object({ exitCode: z.number().int().optional(), stdoutIncludes: z.string().optional() }).strict(),
  timeoutMs: z.number().int().positive()
}).strict();
var ToolRegistrySchema = z.array(ToolSchema);
var CheckRegistrySchema = z.array(CheckSchema);
var registryPath = (root, file) => join(root, ".edu", "harness", file);
async function loadTools(root) {
  return readRegistry(registryPath(root, "tools.json"), ToolRegistrySchema, []);
}
async function loadChecks(root) {
  return readRegistry(registryPath(root, "checks.json"), CheckRegistrySchema, []);
}
async function saveChecks(root, checks) {
  await writeRegistry(registryPath(root, "checks.json"), CheckRegistrySchema, checks);
}
async function readRegistry(path, schema, fallback) {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function writeRegistry(path, schema, value) {
  const validated = schema.parse(value);
  await atomicWrite(path, `${JSON.stringify(validated, null, 2)}
`);
}
async function runCheck(check, cwd, signal) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ checkId: check.id, ok: false, exitCode: null, durationMs: 0, timedOut: false, output: "aborted", stdout: "", stderr: "" });
      return;
    }
    const child = spawn(check.command, { cwd, ...checkSpawnOptions(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid, "SIGTERM");
      const forceKill = setTimeout(() => killProcessGroup(child.pid, "SIGKILL"), 250);
      forceKill.unref();
    }, check.timeoutMs);
    timer.unref();
    const onAbort = () => {
      killProcessGroup(child.pid, "SIGTERM");
      const forceKill = setTimeout(() => killProcessGroup(child.pid, "SIGKILL"), 250);
      forceKill.unref();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      output += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        resolve({ checkId: check.id, ok: false, exitCode: null, durationMs: Date.now() - started, timedOut: false, output: `${output}${error.message}`, stdout, stderr });
      } else reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const exitCode = code;
      const expectedExit = check.expect?.exitCode ?? 0;
      const ok = !timedOut && !signal?.aborted && exitCode === expectedExit && (check.expect?.stdoutIncludes === void 0 || stdout.includes(check.expect.stdoutIncludes));
      resolve({ checkId: check.id, ok, exitCode, durationMs: Date.now() - started, timedOut, output, stdout, stderr });
    });
  });
}
function checkSpawnOptions(platform = process.platform) {
  return { shell: true, detached: platform !== "win32" };
}
function killProcessGroup(pid, signal) {
  if (pid === void 0) return;
  if (process.platform === "win32") {
    if (signal === "SIGKILL") {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      killer.unref();
    } else {
      try {
        process.kill(pid, signal);
      } catch {
      }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
  }
}

// src/evidence/classify.ts
import { readFile as readFile2 } from "fs/promises";
import { join as join2 } from "path";
import { z as z2 } from "zod";
var labels = ["autonomous_verified_success", "assisted_verified_success", "unverified_success", "failed", "unsafe_invalid"];
var taskSchema = z2.object({ requirements: z2.array(z2.object({ id: z2.string().min(1), text: z2.string().optional() })) });
var verificationSchema = z2.object({
  type: z2.literal("verify.result"),
  requirementIds: z2.array(z2.string().min(1)),
  ok: z2.boolean(),
  kind: z2.enum(["reproduction", "deterministic", "targeted-test", "regression", "lint", "review"]),
  checkId: z2.string().optional(),
  method: z2.string().optional(),
  output: z2.string().optional(),
  at: z2.string().optional(),
  exitCode: z2.number().int().nullable().optional(),
  durationMs: z2.number().finite().nonnegative().optional(),
  timedOut: z2.boolean().optional()
});
var outcomeSchema = z2.object({
  type: z2.enum(["outcome", "run.end"]).optional(),
  label: z2.enum(labels).optional(),
  ok: z2.boolean().optional(),
  metrics: z2.record(z2.string(), z2.unknown()).optional(),
  at: z2.string().optional()
}).refine((value) => (value.label !== void 0 || value.ok !== void 0) && (value.type !== "run.end" || value.ok !== void 0) && (value.type !== "outcome" || value.label !== void 0));
var entropySchema = z2.object({ findings: z2.array(z2.object({ category: z2.string(), severity: z2.number().int().min(0).max(3) })) });
var interventionSchema = z2.object({
  type: z2.enum(["intervention", "approval.resolve"]).optional(),
  avoidable: z2.boolean().optional(),
  approved: z2.boolean().optional(),
  by: z2.enum(["user", "policy"]).optional()
}).refine((value) => value.avoidable !== void 0 || value.approved !== void 0);
async function diagnosePackage(directory) {
  try {
    const [task, verifications, entropy, outcome, interventions] = await Promise.all([
      readJson(directory, "task.json").then((value) => taskSchema.parse(value)),
      readJsonl(directory, "verification.jsonl").then((value) => z2.array(verificationSchema).parse(value)),
      readJson(directory, "entropy.json").then((value) => entropySchema.parse(value)),
      readJson(directory, "outcome.json").then((value) => outcomeSchema.parse(value)),
      readJsonl(directory, "intervention.jsonl").then((value) => z2.array(interventionSchema).parse(value))
    ]);
    const result = (label, reason) => ({ label, reasons: [reason] });
    if (outcome.label === "unsafe_invalid" || entropy.findings.some((finding) => ["weakened-tests", "checks-bypassed", "unsafe-invalid"].includes(finding.category))) return result("unsafe_invalid", "unsafe evidence");
    if (outcome.ok === false || outcome.label === "failed") return result("failed", "terminal failure");
    if (new Set(task.requirements.map((req) => req.id)).size !== task.requirements.length) return result("failed", "duplicate requirement ids");
    const latest = /* @__PURE__ */ new Map();
    const deterministicFailures = /* @__PURE__ */ new Set();
    const final = verifications.filter((event) => event.kind !== "reproduction");
    for (const event of final) for (const id of event.requirementIds) {
      latest.set(id, event.ok);
      if (event.kind === "deterministic") {
        if (event.ok) deterministicFailures.delete(id);
        else deterministicFailures.add(id);
      }
    }
    if (deterministicFailures.size || [...latest.values()].includes(false) || final.some((event) => !event.requirementIds.length && !event.ok)) return result("failed", "unresolved verification failure");
    const verified = task.requirements.length > 0 && task.requirements.every((req) => latest.get(req.id) === true);
    if (!verified) return result("unverified_success", "terminal success without complete requirement coverage");
    const assisted = interventions.some((event) => event.type !== "approval.resolve" || event.by !== "policy");
    return result(assisted ? "assisted_verified_success" : "autonomous_verified_success", "terminal success with requirement coverage");
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z2.ZodError || error.code === "ENOENT") return { label: "failed", reasons: ["incomplete or malformed package evidence"] };
    throw error;
  }
}
async function classifyPackage(directory) {
  return (await diagnosePackage(directory)).label;
}
async function readJson(directory, name) {
  return JSON.parse(await readFile2(join2(directory, name), "utf8"));
}
async function readJsonl(directory, name) {
  return (await readFile2(join2(directory, name), "utf8")).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

export {
  CheckSchema,
  loadTools,
  loadChecks,
  saveChecks,
  runCheck,
  diagnosePackage,
  classifyPackage
};
//# sourceMappingURL=chunk-DXBGSU5D.js.map