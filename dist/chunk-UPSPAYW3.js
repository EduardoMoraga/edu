// src/platform/file-lock.ts
import { createHash } from "crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
var LOCK_WAIT_MS = 5e3;
var LOCK_STALE_MS = 3e4;
var pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function withHostLock(root, source, key, body, waitMs = LOCK_WAIT_MS) {
  const dir = join(root, "state", "locks", `${createHash("sha256").update(`${source}\0${key}`).digest("hex").slice(0, 32)}.lock`);
  await mkdir(join(root, "state", "locks"), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (; ; ) {
    try {
      await mkdir(dir);
      await writeFile(join(dir, "owner"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (await staleLock(dir)) {
      const claimed = `${dir}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename(dir, claimed);
        await rm(claimed, { recursive: true, force: true });
      } catch {
      }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for the ${source} session lock`);
    await pause(25);
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
    if (age < LOCK_STALE_MS) return false;
    const pid = Number((await readFile(join(dir, "owner"), "utf8").catch(() => "")).trim());
    return !(Number.isInteger(pid) && pid > 0 && alive(pid));
  } catch {
    return false;
  }
}

export {
  withHostLock
};
//# sourceMappingURL=chunk-UPSPAYW3.js.map