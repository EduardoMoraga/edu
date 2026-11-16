import {
  t
} from "./chunk-YLMSGSHR.js";

// src/cli/run/session.ts
async function executeRun(ctx, setup) {
  const available = setup.available ?? ctx.availableClis ?? await ctx.detectClis();
  if (!available.length) throw new Error(t(setup.lang, "run.noCli"));
  const { runSession } = await import("./session-IT5AN6MF.js");
  return runSession({ available, env: ctx.env, home: ctx.home }, { ...setup, engines: setup.engines ?? ctx.engineFactory });
}

export {
  executeRun
};
//# sourceMappingURL=chunk-UI5CWPGL.js.map