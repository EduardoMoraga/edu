import {
  packageTemplatesDir
} from "./chunk-BXZ573JQ.js";
import {
  initBrain
} from "./chunk-MJWWG6V6.js";
import {
  t
} from "./chunk-NQTHVZEM.js";
import {
  effectiveConfig,
  exists,
  openWorkspace
} from "./chunk-2V65STGZ.js";

// src/cli/run/session.ts
import { join } from "path";
async function executeRun(ctx, setup) {
  const available = setup.available ?? ctx.availableClis ?? await ctx.detectClis();
  if (!available.length) throw new Error(t(setup.lang, "run.noCli"));
  if (setup.cli && !available.includes(setup.cli)) throw new Error(`${setup.cli} is not installed (found: ${available.join(", ")})`);
  const ws = await openWorkspace(ctx, setup.cwd);
  if (!await exists(join(ws.primary.root, "EDU.md"))) {
    await initBrain({ location: ws.primary, templatesDir: packageTemplatesDir(), detected: available, lang: setup.lang });
  }
  const base = await effectiveConfig(ws.primary.root, available);
  const config = { ...base, mode: setup.mode ?? base.mode, defaultCli: setup.cli ?? base.defaultCli };
  const [{ orchestrate }, { buildContext }, engineModule] = await Promise.all([
    import("./orchestrator-4SDO5OAG.js"),
    import("./context-XPSRY245.js"),
    import("./engine-EA7LU35N.js")
  ]);
  const eduMdPath = join(ws.primary.root, "EDU.md");
  return orchestrate(setup.goal, {
    config,
    brain: ws.brain,
    context: { build: (req) => buildContext(ws.brain, req, { eduMdPath }) },
    engines: setup.engines ?? ctx.engineFactory ?? engineModule.createEngine,
    available,
    cwd: setup.cwd,
    onEvent: setup.onEvent,
    approve: setup.approve,
    signal: setup.signal,
    harnessLevel: setup.harnessLevel,
    runsDir: join(ws.primary.root, "runs")
  });
}

export {
  executeRun
};
//# sourceMappingURL=chunk-GCXEUMI3.js.map