import {
  assertContained,
  canonicalAnchor
} from "./chunk-6VKNJRFI.js";
import {
  killTree,
  trackChild
} from "./chunk-CAQVQMTA.js";

// src/experiment/run.ts
import { spawn } from "child_process";
import { mkdtemp, mkdir as mkdir2, rm, writeFile as writeFile2, rename } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join as join2, relative, resolve, isAbsolute as isAbsolute2 } from "path";

// src/experiment/contract.ts
import { createHash } from "crypto";
import { isAbsolute } from "path";
import { z } from "zod";
var sha256 = (value) => createHash("sha256").update(value).digest("hex");
var Digest = z.string().regex(/^[a-f0-9]{64}$/);
function workspacePath(path) {
  const parts = path.split("/");
  if (!path || path.length > 1024 || parts.length > 32 || parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f\x7f<>:"\\|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Invalid portable workspace path: ${path}`);
  return path;
}
var pathKey = (path) => path.normalize("NFC").toLowerCase();
var Path = z.string().refine((value) => {
  try {
    workspacePath(value);
    return true;
  } catch {
    return false;
  }
}, "Invalid portable experiment path");
var Command = z.object({ executable: z.string().min(1).refine(isAbsolute, "Use an absolute trusted executable path"), args: z.array(z.string()).max(256) }).strict();
var ExperimentSchema = z.object({
  version: z.literal(1),
  sourceRoot: z.string().refine(isAbsolute, "sourceRoot must be absolute"),
  sourceSha256: Digest,
  baseline: Command,
  candidate: Command,
  overlay: z.record(Path, z.string()).default({}),
  protected: z.array(Path).max(256).default([]),
  artifacts: z.array(Path).min(1).max(64),
  checks: z.array(z.object({ id: z.string().min(1).max(100), path: Path, sha256: Digest }).strict()).max(64).default([]),
  criterion: z.enum(["retain-baseline", "artifact-match-gain"]).default("retain-baseline"),
  isolation: z.literal("workspace-copy"),
  limits: z.object({
    timeoutMs: z.number().int().min(10).max(6e5),
    outputBytes: z.number().int().min(1).max(4 * 1024 * 1024),
    workspaceBytes: z.number().int().min(1).max(128 * 1024 * 1024),
    files: z.number().int().min(1).max(4096)
  }).strict()
}).strict();
var ISOLATION_LIMITS = [
  "Trusted commands only; shell is disabled but approved executables can run arbitrary code.",
  "Disposable workspace copies are not an OS, filesystem-permission or network sandbox.",
  "Commands can access host files and network. Enforced isolation requirements are unsupported.",
  "Workspace limits are checked during and after execution, not an OS disk quota; transient writes can exceed them.",
  "Process-group cleanup is best effort; hostile commands can escape it. No automatic models or adoption."
];
function parseManifest(manifest) {
  if (Buffer.byteLength(manifest) > 2 * 1024 * 1024) throw new Error("Experiment manifest exceeds 2 MiB");
  const spec = ExperimentSchema.parse(JSON.parse(manifest));
  if (new Set(spec.artifacts.map(pathKey)).size !== spec.artifacts.length || new Set(spec.checks.map((c) => c.id)).size !== spec.checks.length) throw new Error("Duplicate artifact or check");
  if (spec.checks.some((check) => !spec.artifacts.includes(check.path))) throw new Error("Checks must reference declared artifacts");
  for (const [path, content] of Object.entries(spec.overlay)) {
    if (content.includes("\0") || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(content)) !== content) throw new Error(`Overlay must be UTF-8 text: ${path}`);
    if (spec.artifacts.some((artifact) => pathKey(artifact) === pathKey(path) || pathKey(artifact).startsWith(pathKey(path) + "/") || pathKey(path).startsWith(pathKey(artifact) + "/"))) throw new Error(`Overlay cannot provide required artifacts: ${path}`);
    if (protectedPath(path, spec)) throw new Error(`Overlay cannot change protected path: ${path}`);
  }
  return spec;
}
function protectedPath(path, spec) {
  const parts = path.split("/").map((p) => p.toLowerCase());
  const brain = parts.indexOf(".edu");
  const knownPolicy = parts.some((p) => /^(?:agents\.md|claude\.md|gemini\.md|edu\.md|\.mcp\.json|\.claude-plugin|\.codex-plugin|\.codex|\.claude|\.pi|\.gemini|\.git|node_modules)$/.test(p)) || parts.some((p, i) => p === ".agents" && parts[i + 1] === "plugins" || p === ".config" && parts[i + 1] === "opencode") || brain >= 0 && /^(?:config\.json|edu\.md|manifest\.json|plugin-setup\.json|harness)$/.test(parts[brain + 1] ?? "");
  return knownPolicy || spec.protected.some((p) => pathKey(path) === pathKey(p) || pathKey(path).startsWith(pathKey(p) + "/") || pathKey(p).startsWith(pathKey(path) + "/")) || path.split("/").some((p) => /^(?:checks?|evaluators?|tests?|__tests__|package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements.*\.txt|pyproject\.toml|Cargo\.(?:toml|lock)|.*\.(?:test|spec)\.[cm]?[jt]sx?|(?:vitest|jest)\.config\..*)$/i.test(p));
}

// src/experiment/workspace.ts
import { lstat, readdir, readFile, mkdir, writeFile, chmod } from "fs/promises";
import { join } from "path";
var excluded = (name) => /^(?:\.git|\.edu|\.cloudroom|\.codex|\.claude|\.pi|\.gemini|node_modules|\.ssh|\.aws|\.azure|\.gcloud|\.config|\.npm|\.gnupg|\.kube|credentials?|secrets?)(?:$|\.)/i.test(name) || /^\.env(?:$|\.)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || /^(?:id_rsa|id_ed25519|\.netrc|\.npmrc|\.pypirc|\.mcp\.json)$/i.test(name);
var entryDigest = (entry) => entry.kind === "directory" ? { kind: entry.kind } : { kind: entry.kind, sha256: sha256(entry.bytes), executable: entry.executable };
var snapshotDigests = (files) => Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, entry]) => [path, entryDigest(entry)]));
var snapshotHash = (files) => sha256(JSON.stringify(snapshotDigests(files)));
async function snapshot(root, limits, source = false, monitor = false) {
  await assertContained(root, root);
  const files = /* @__PURE__ */ new Map();
  let bytes = 0, entries = 0;
  const names = /* @__PURE__ */ new Set();
  const walk = async (directory, prefix) => {
    for (const name of (await readdir(directory)).sort()) {
      if (source && excluded(name)) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      workspacePath(path);
      if (names.has(pathKey(path))) throw new Error(`Workspace case/Unicode collision: ${path}`);
      names.add(pathKey(path));
      if (++entries > limits.files) throw new Error("Workspace file/entry limit exceeded");
      const target = join(root, path);
      try {
        await assertContained(root, target);
        const stat = await lstat(target);
        if (stat.isDirectory()) {
          files.set(path, { kind: "directory" });
          await walk(target, path);
        } else if (stat.isFile()) {
          bytes += stat.size;
          if (bytes > limits.workspaceBytes) throw new Error("Workspace byte limit exceeded");
          if (monitor) continue;
          const value = await readFile(target);
          if (value.length !== stat.size) throw new Error(`Workspace changed during snapshot: ${path}`);
          files.set(path, { kind: "file", bytes: value, executable: process.platform === "win32" ? 0 : stat.mode & 73 });
        } else throw new Error(`Refusing symlink or special workspace file: ${path}`);
      } catch (error) {
        if (!monitor || error.code !== "ENOENT") throw error;
      }
    }
  };
  await walk(root, "");
  return files;
}
async function materialize(root, files) {
  await mkdir(root, { recursive: true });
  for (const [path, entry] of files) {
    await assertContained(root, join(root, path));
    if (entry.kind === "directory") await mkdir(join(root, path), { recursive: true });
    else {
      await writeFile(join(root, path), entry.bytes, { flag: "wx", mode: 420 | entry.executable });
      if (process.platform !== "win32") await chmod(join(root, path), 420 | entry.executable);
    }
  }
}
function overlaySnapshot(initial, overlay, limits) {
  const files = new Map(initial);
  for (const [path, content] of Object.entries(overlay)) {
    const previous = files.get(path);
    if (previous?.kind === "directory") throw new Error(`Overlay file/directory collision: ${path}`);
    files.set(path, { kind: "file", bytes: Buffer.from(content), executable: previous?.executable ?? 0 });
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (files.get(parent)?.kind === "file") throw new Error(`Overlay file/parent collision: ${parent}`);
      if (!files.has(parent)) files.set(parent, { kind: "directory" });
    }
  }
  const names = /* @__PURE__ */ new Set();
  let bytes = 0;
  for (const [path, entry] of files) {
    if (names.has(pathKey(path))) throw new Error(`Workspace case/Unicode collision: ${path}`);
    names.add(pathKey(path));
    if (entry.kind === "file") bytes += entry.bytes.length;
  }
  if (files.size > limits.files || bytes > limits.workspaceBytes) throw new Error("Workspace inventory limit exceeded");
  return files;
}

// src/experiment/run.ts
async function inspectExperiment(manifest) {
  const spec = parseManifest(manifest);
  const inputs = await snapshot(spec.sourceRoot, spec.limits, true);
  overlaySnapshot(inputs, spec.overlay, spec.limits);
  return {
    manifestSha256: sha256(manifest),
    sourceSha256: snapshotHash(inputs),
    approvalReady: spec.sourceSha256 === snapshotHash(inputs),
    inputs: snapshotDigests(inputs),
    spec,
    limitations: ISOLATION_LIMITS
  };
}
var emptyArm = () => ({ status: "not-run", durationMs: 0, exitCode: null, stdout: "", stderr: "", artifacts: {}, checks: [] });
async function runExperiment(manifest, deps) {
  if (sha256(manifest) !== deps.approve) throw new Error("Exact manifest approval SHA256 mismatch");
  const spec = parseManifest(manifest);
  const initial = await snapshot(spec.sourceRoot, spec.limits, true);
  if (snapshotHash(initial) !== spec.sourceSha256) throw new Error("Frozen source digest mismatch; inspect and approve fresh inputs");
  for (const path of spec.protected) if (![...initial.keys()].some((p) => p === path || p.startsWith(path + "/"))) throw new Error(`Missing protected input: ${path}`);
  overlaySnapshot(initial, spec.overlay, spec.limits);
  for (const path of spec.artifacts) if (initial.has(path)) throw new Error(`Required artifact already exists in source: ${path}`);
  const protectedInventory = (files) => Object.fromEntries(Object.entries(snapshotDigests(files)).filter(([path]) => protectedPath(path, spec)));
  const frozen = protectedInventory(initial);
  if (!deps.evidenceRoot) throw new Error("An explicit evidence directory outside the source is required");
  const evidenceRoot = resolve(deps.evidenceRoot);
  const rel = relative(await canonicalAnchor(spec.sourceRoot), await canonicalAnchor(evidenceRoot));
  if (!rel || !rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) && rel !== ".." && !isAbsolute2(rel)) {
    throw new Error("Evidence directory must be outside original source");
  }
  const root = await mkdtemp(join2(tmpdir(), "edu-experiment-"));
  const evidencePath = join2(evidenceRoot, `${root.split(/[\\/]/).at(-1)}.json`);
  const result = {
    version: 1,
    state: "running",
    manifestSha256: sha256(manifest),
    spec,
    inputs: snapshotDigests(initial),
    overlaySha256: sha256(JSON.stringify(spec.overlay)),
    checksSha256: sha256(JSON.stringify(spec.checks)),
    protectedSha256: frozen,
    commandsSha256: sha256(JSON.stringify([spec.baseline, spec.candidate])),
    artifactsSha256: sha256(JSON.stringify(spec.artifacts)),
    isolation: "workspace-copy",
    limitations: ISOLATION_LIMITS,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    endedAt: "",
    evidencePath,
    usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null },
    arms: { baseline: emptyArm(), candidate: emptyArm() },
    decision: "inconclusive",
    fallbackUsable: false
  };
  try {
    await mkdir2(evidenceRoot, { recursive: true, mode: 448 });
    await assertContained(evidenceRoot, evidencePath);
    await writeFile2(evidencePath, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 384 });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  try {
    for (const arm of ["baseline", "candidate"]) await materialize(join2(root, arm), initial);
    for (const arm of ["baseline", "candidate"]) {
      if (deps.signal?.aborted) {
        if (arm === "baseline") result.arms.baseline.status = "cancelled";
        break;
      }
      const outcome = result.arms[arm];
      outcome.initialSha256 = snapshotHash(initial);
      const cwd = join2(root, arm);
      try {
        outcome.initialSha256 = snapshotHash(await snapshot(cwd, spec.limits));
        if (outcome.initialSha256 !== spec.sourceSha256) throw new Error("Initial workspace snapshot changed before execution");
        if (arm === "candidate") for (const [path, content] of Object.entries(spec.overlay)) {
          await assertContained(cwd, join2(cwd, path));
          await mkdir2(dirname(join2(cwd, path)), { recursive: true });
          await writeFile2(join2(cwd, path), content);
        }
        const before = await snapshot(cwd, spec.limits);
        if (JSON.stringify(protectedInventory(before)) !== JSON.stringify(frozen)) throw new Error("Protected inventory changed before execution");
        Object.assign(outcome, await execute(spec[arm], cwd, spec.limits, deps.signal));
        const final = await snapshot(cwd, spec.limits);
        if (JSON.stringify(protectedInventory(final)) !== JSON.stringify(frozen)) throw new Error("Protected inventory changed after execution");
        for (const path of spec.artifacts) {
          const artifact = final.get(path);
          if (artifact?.kind !== "file") throw new Error(`Missing required artifact: ${path}`);
          outcome.artifacts[path] = sha256(artifact.bytes);
        }
        outcome.checks = spec.checks.map((check) => ({ id: check.id, ok: outcome.artifacts[check.path] === check.sha256 }));
      } catch (error) {
        if (outcome.status === "ok" || outcome.status === "not-run") outcome.status = "invalid";
        outcome.error = error instanceof Error ? error.message : String(error);
      }
    }
    result.fallbackUsable = result.arms.baseline.status === "ok";
    if (result.fallbackUsable) {
      result.decision = "baseline";
      if (spec.criterion === "artifact-match-gain" && result.arms.candidate.status === "ok" && result.arms.baseline.checks.some((c) => !c.ok) && result.arms.candidate.checks.length > 0 && result.arms.candidate.checks.every((c) => c.ok)) result.decision = "candidate";
    }
  } catch (error) {
    result.arms.baseline.status = "invalid";
    result.arms.baseline.error = String(error);
  } finally {
    result.endedAt = (/* @__PURE__ */ new Date()).toISOString();
    result.state = "complete";
    try {
      await mkdir2(evidenceRoot, { recursive: true });
      await assertContained(evidenceRoot, evidencePath);
      const staging = evidencePath + ".tmp";
      await assertContained(evidenceRoot, staging);
      await writeFile2(staging, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 384 });
      await rename(staging, evidencePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  return result;
}
async function execute(command, cwd, limits, signal) {
  const started = Date.now();
  if (signal?.aborted) return { status: "cancelled", durationMs: 0, exitCode: null, stdout: "", stderr: "" };
  return new Promise((done) => {
    let status = "ok", stdout = "", stderr = "", used = 0, error;
    let settled = false, closing = false, exitCode = null;
    let scanning, drain;
    const child = spawn(command.executable, command.args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: Object.fromEntries(["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : [])),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const untrack = trackChild(child);
    const kill = () => {
      if (!child.pid || settled) return;
      void killTree(child, "SIGKILL");
    };
    const finish = () => {
      if (settled || closing) return;
      closing = true;
      clearTimeout(timer);
      clearTimeout(drain);
      clearInterval(monitor);
      signal?.removeEventListener("abort", abort);
      kill();
      untrack();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      settled = true;
      void (scanning ?? Promise.resolve()).finally(() => done({
        status: status === "ok" && exitCode !== 0 ? "nonzero" : status,
        exitCode,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        ...error ? { error } : {}
      }));
    };
    const stop = (reason) => {
      if (settled || closing || status !== "ok") return;
      status = reason;
      kill();
      drain ??= setTimeout(finish, 200);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), limits.timeoutMs);
    const monitor = setInterval(() => {
      if (scanning || settled || closing) return;
      scanning = snapshot(cwd, limits, false, true).then(() => {
      }, (e) => {
        if (settled || closing) return;
        error = String(e);
        stop("invalid");
      }).finally(() => {
        scanning = void 0;
      });
    }, 100);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunk, stream) => {
      if (settled || closing) return;
      const keep = chunk.subarray(0, Math.max(0, limits.outputBytes - used));
      used += chunk.length;
      if (stream === "stdout") stdout += keep.toString("utf8");
      else stderr += keep.toString("utf8");
      if (used > limits.outputBytes) stop("output-limit");
    };
    child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(chunk, "stderr"));
    child.once("error", (e) => {
      if (!settled && !closing) {
        error = e.message;
        status = "invalid";
        finish();
      }
    });
    child.once("exit", (code) => {
      if (!settled && !closing) exitCode = code;
    });
    child.once("close", (code) => {
      if (!settled && !closing) {
        exitCode = code;
        finish();
      }
    });
  });
}
export {
  inspectExperiment,
  runExperiment
};
//# sourceMappingURL=run-M44N2NF4.js.map