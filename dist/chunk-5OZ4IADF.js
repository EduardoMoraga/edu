import {
  t
} from "./chunk-6EQ5USXO.js";

// src/cli/run/session.ts
async function executeRun(ctx, setup) {
  const available = setup.available ?? ctx.availableClis ?? await ctx.detectClis();
  if (!available.length) throw new Error(t(setup.lang, "run.noCli"));
  const { runSession } = await import("./session-B3LC24VT.js");
  return runSession({ available, env: ctx.env, home: ctx.home }, { ...setup, engines: setup.engines ?? ctx.engineFactory });
}

export {
  executeRun
};
//# sourceMappingURL=chunk-5OZ4IADF.js.map