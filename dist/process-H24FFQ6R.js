// src/update/process.ts
import spawn from "cross-spawn";
var spawnRunner = (command, args, opts = {}) => new Promise((resolve) => {
  const child = spawn(command, args, { env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs) : void 0;
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", (error) => {
    if (timer) clearTimeout(timer);
    resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
  });
  child.on("close", (code, signal) => {
    if (timer) clearTimeout(timer);
    resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr: signal ? `${stderr}
terminated by ${signal}` : stderr });
  });
});
export {
  spawnRunner
};
//# sourceMappingURL=process-H24FFQ6R.js.map