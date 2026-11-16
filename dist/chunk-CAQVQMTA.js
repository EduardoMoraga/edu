// src/platform/process-tree.ts
import { execFile, spawn, spawnSync } from "child_process";
import { readFile } from "fs/promises";
import { constants } from "os";
var DEFAULT_DRAIN_MS = 200;
var DEFAULT_TASKKILL_TIMEOUT_MS = 5e3;
function processAlive(pid) {
  if (pid === void 0 || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function manualKill(pid, platform) {
  return platform === "win32" ? `taskkill /pid ${pid} /t /f` : `kill -TERM -- -${pid}`;
}
var ProcessCheckError = class extends Error {
  constructor(pid, reason, platform = process.platform) {
    super(`process ${pid} could not be verified as the job's worker (${reason}), so nothing was signalled and it may still be running. Confirm what it is, then stop its tree with: ${manualKill(pid, platform)}`);
    this.pid = pid;
    this.name = "ProcessCheckError";
  }
  pid;
  code = "process-unverified";
};
function runProbe(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true, timeout: 5e3 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}
function probeFailure(command, error) {
  const failure = error;
  if (failure.killed) return `${command} timed out`;
  if (typeof failure.code === "number") return `${command} exited with code ${failure.code}`;
  return `${command} could not run (${failure.code ?? failure.message})`;
}
async function describeProcess(pid, options = {}) {
  const platform = options.platform ?? process.platform;
  const alive = options.alive ?? processAlive;
  if (!Number.isSafeInteger(pid) || pid <= 0) return void 0;
  const [command, args] = platform === "win32" ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`]] : ["ps", ["-o", "args=", "-p", String(pid)]];
  let reason;
  try {
    const stdout = await (options.run ?? runProbe)(command, [...args]);
    const found = stdout.trim() || void 0;
    if (found || !alive(pid)) return found;
    reason = `${command} did not list it`;
  } catch (error) {
    if (!alive(pid)) return void 0;
    reason = probeFailure(command, error);
  }
  if (platform === "linux") {
    try {
      const cmdline = (await (options.readCmdline ?? ((p) => readFile(`/proc/${p}/cmdline`, "utf8")))(pid)).split("\0").join(" ").trim();
      if (cmdline) return cmdline;
    } catch {
    }
  }
  throw new ProcessCheckError(pid, reason, platform);
}
function exited(child) {
  return (child.exitCode ?? null) !== null || (child.signalCode ?? null) !== null;
}
function startTaskkill(args) {
  const killer = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
  killer.on("error", () => void 0);
  return killer;
}
function waitFor(emitter, events, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    for (const event of events) emitter.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
async function drain(child, ms) {
  const open = [child.stdout, child.stderr].filter((stream) => Boolean(stream) && !stream.destroyed && !stream.readableEnded);
  if (!open.length) return;
  await Promise.race([
    Promise.all(open.map((stream) => new Promise((resolve) => stream.once("close", () => resolve())))),
    new Promise((resolve) => setTimeout(resolve, ms))
  ]);
  for (const stream of open) if (!stream.destroyed) stream.destroy();
}
async function killTree(child, signal = "SIGTERM", options = {}) {
  const pid = child.pid;
  if (pid === void 0) return;
  if ((options.platform ?? process.platform) !== "win32") {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        child.kill?.(signal);
      } catch {
      }
    }
    return;
  }
  if (!exited(child)) {
    const killer = (options.taskkill ?? startTaskkill)(["/pid", String(pid), "/t", "/f"]);
    await waitFor(killer, ["exit", "error"], options.taskkillTimeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS);
  }
  await drain(child, options.drainMs ?? DEFAULT_DRAIN_MS);
}
function killTreeSync(child, signal = "SIGKILL", platform = process.platform, taskkillSync = (args) => {
  spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true, timeout: DEFAULT_TASKKILL_TIMEOUT_MS });
}) {
  const pid = child.pid;
  if (pid === void 0) return;
  if (platform === "win32") {
    if (!exited(child)) taskkillSync(["/pid", String(pid), "/t", "/f"]);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill?.(signal);
    } catch {
    }
  }
}
var STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
function pauseSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function createChildRegistry(options = {}) {
  const proc = options.proc ?? process;
  const kill = options.kill ?? ((child, signal) => killTreeSync(child, signal));
  const graceMs = options.graceMs ?? 200;
  const pause = options.pause ?? pauseSync;
  const children = /* @__PURE__ */ new Set();
  let signalsInstalled = false;
  let exitInstalled = false;
  const killAll = (signal) => {
    for (const child of children) {
      try {
        kill(child, signal);
      } catch {
      }
    }
  };
  const handlers = /* @__PURE__ */ new Map();
  const removeSignals = () => {
    if (!signalsInstalled) return;
    signalsInstalled = false;
    for (const [signal, handler] of handlers) proc.removeListener(signal, handler);
  };
  for (const signal of STOP_SIGNALS) {
    handlers.set(signal, () => {
      const shared = proc.listenerCount(signal) > 1;
      if (children.size) {
        killAll("SIGTERM");
        pause(graceMs);
        killAll("SIGKILL");
      }
      if (shared) removeSignals();
      else proc.exit(128 + (constants.signals[signal] ?? 1));
    });
  }
  const onExit = () => killAll("SIGKILL");
  const install = () => {
    if (!signalsInstalled) {
      signalsInstalled = true;
      for (const [signal, handler] of handlers) proc.prependListener(signal, handler);
    }
    if (!exitInstalled) {
      exitInstalled = true;
      proc.prependListener("exit", onExit);
    }
  };
  const uninstall = () => {
    removeSignals();
    if (exitInstalled) {
      exitInstalled = false;
      proc.removeListener("exit", onExit);
    }
  };
  return {
    track(child) {
      if (child.pid === void 0 || exited(child)) return () => void 0;
      children.add(child);
      install();
      return () => {
        if (!children.delete(child)) return;
        if (!children.size) uninstall();
      };
    },
    get size() {
      return children.size;
    }
  };
}
var defaultRegistry = createChildRegistry();
function trackChild(child) {
  return defaultRegistry.track(child);
}

export {
  processAlive,
  describeProcess,
  killTree,
  trackChild
};
//# sourceMappingURL=chunk-CAQVQMTA.js.map