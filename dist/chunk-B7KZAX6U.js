// src/platform/process-tree.ts
import { spawn, spawnSync } from "child_process";
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
async function describeProcess(pid, platform = process.platform) {
  const { execFile } = await import("child_process");
  const run = (command, args) => new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true, timeout: 5e3 }, (error, stdout) => resolve(error ? "" : stdout));
  });
  if (platform === "win32") return imageFromTasklist(await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]), pid);
  return (await run("ps", ["-o", "args=", "-p", String(pid)])).trim() || void 0;
}
function imageFromTasklist(output, pid) {
  for (const row of output.split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(row.trim());
    if (match && Number(match[2]) === pid) return match[1];
  }
  return void 0;
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
//# sourceMappingURL=chunk-B7KZAX6U.js.map