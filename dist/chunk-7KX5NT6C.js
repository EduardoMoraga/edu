import {
  atomicWrite
} from "./chunk-2AE6KVNY.js";

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

export {
  CheckSchema,
  loadTools,
  loadChecks,
  saveChecks,
  runCheck
};
//# sourceMappingURL=chunk-7KX5NT6C.js.map