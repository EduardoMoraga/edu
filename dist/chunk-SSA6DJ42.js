import {
  packageTemplatesDir
} from "./chunk-BXZ573JQ.js";
import {
  t
} from "./chunk-VIZUUMRZ.js";
import {
  initBrain
} from "./chunk-DDWOZAZN.js";
import {
  effectiveConfig,
  exists,
  openWorkspace
} from "./chunk-IIELWA3V.js";

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
  const config = { ...base, mode: setup.mode ?? base.mode, defaultCli: setup.cli ?? base.defaultCli, approvals: setup.autoApprove ? "auto" : base.approvals };
  const [{ orchestrate }, { buildContext }, engineModule] = await Promise.all([
    import("./orchestrator-DSWNEXA2.js"),
    import("./context-PAFLCUYP.js"),
    import("./engine-XNHO6CDU.js")
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
    playbookName: setup.playbook,
    autoApprove: setup.autoApprove,
    runsDir: join(ws.primary.root, "runs")
  });
}

export {
  executeRun
};
//# sourceMappingURL=chunk-SSA6DJ42.js.map