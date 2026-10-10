// src/cli/context.ts
import { homedir } from "os";
import { resolve } from "path";
function resolveGlobals(ctx, opts) {
  const locale = ctx.env.LC_ALL || ctx.env.LANG || "";
  const raw = opts.lang ?? ctx.env.EDU_LANG ?? (locale.toLowerCase().startsWith("es") ? "es" : "en");
  const lang = raw === "es" ? "es" : "en";
  return { cwd: resolve(ctx.cwd, opts.cwd ?? "."), lang, json: Boolean(opts.json) };
}
function globalHome(ctx) {
  return resolve(ctx.env.EDU_HOME || resolve(ctx.home, ".edu"));
}
function readStream(stream, timeoutMs = 1e3) {
  if (stream.isTTY) return Promise.resolve("");
  return new Promise((done) => {
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", finish);
      stream.removeListener("error", finish);
      stream.pause?.();
      done(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    stream.on("data", onData);
    stream.once("end", finish);
    stream.once("error", finish);
    stream.resume?.();
  });
}
function processContext() {
  return {
    cwd: process.cwd(),
    env: process.env,
    home: process.env.HOME || homedir(),
    out: (text) => void process.stdout.write(text.endsWith("\n") ? text : `${text}
`),
    err: (text) => void process.stderr.write(text.endsWith("\n") ? text : `${text}
`),
    readStdin: (timeoutMs) => readStream(process.stdin, timeoutMs),
    isTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    async confirm(question) {
      const { createInterface } = await import("readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
    async detectClis() {
      const { detectEngines } = await import("./engine-XNHO6CDU.js");
      return detectEngines();
    },
    setExitCode: (code) => {
      process.exitCode = code;
    }
  };
}

export {
  resolveGlobals,
  globalHome,
  processContext
};
//# sourceMappingURL=chunk-XXPGZ7G6.js.map