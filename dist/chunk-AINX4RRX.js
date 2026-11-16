// src/platform/fs-retry.ts
import { readFile, rename, rmdir, unlink, writeFile } from "fs/promises";
var FS_RETRY_BACKOFF_MS = [10, 20, 40, 80, 160, 320, 400, 400, 400];
var fsRetryDefaults = {
  platform: process.platform,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms))
};
function isTransientLock(error, platform = fsRetryDefaults.platform) {
  const code = error?.code;
  return code === "EBUSY" || platform === "win32" && (code === "EPERM" || code === "EACCES");
}
async function withFsRetry(op, options = {}) {
  const platform = options.platform ?? fsRetryDefaults.platform;
  const sleep = options.sleep ?? fsRetryDefaults.sleep;
  const backoff = options.backoff ?? FS_RETRY_BACKOFF_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (error) {
      const delay = backoff[attempt];
      if (delay === void 0 || !isTransientLock(error, platform)) throw error;
      await sleep(delay);
    }
  }
}
var retryFs = {
  readFile: (path) => withFsRetry(() => readFile(path)),
  writeFile: (path, content) => withFsRetry(() => writeFile(path, content)),
  rename: (from, to) => withFsRetry(() => rename(from, to)),
  unlink: (path) => withFsRetry(() => unlink(path)),
  rmdir: (path) => withFsRetry(() => rmdir(path))
};

export {
  withFsRetry,
  retryFs
};
//# sourceMappingURL=chunk-AINX4RRX.js.map