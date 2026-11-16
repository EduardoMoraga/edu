import {
  initBrain
} from "./chunk-SEUDRFSL.js";
import {
  resolveBrainLocations
} from "./chunk-ORYLFQE5.js";
import {
  openBrain
} from "./chunk-SOBMA5SW.js";
import {
  packageTemplatesDir
} from "./chunk-NMJNTHQG.js";

// src/orchestrator/session.ts
import { access } from "fs/promises";
import { join } from "path";
var NO_CLI_MESSAGE = "No supported coding CLI found on PATH. Install one, or try: edu demo";
async function runSession(host, request) {
  const { available } = host;
  if (!available.length) throw new Error(NO_CLI_MESSAGE);
  if (request.cli && !available.includes(request.cli)) throw new Error(`${request.cli} is not installed (found: ${available.join(", ")})`);
  const locations = await resolveBrainLocations(request.cwd, { ...host.env, HOME: host.env.HOME ?? host.home });
  const primary = locations[0];
  const brain = openBrain(locations);
  const eduMdPath = join(primary.root, "EDU.md");
  if (!await exists(eduMdPath)) {
    await initBrain({ location: primary, templatesDir: packageTemplatesDir(), detected: available, lang: request.lang });
  }
  const [{ defaultConfig, loadConfig, loadCrewPolicy }, { orchestrate }, { buildContext }, { createEngine }] = await Promise.all([
    import("./config-IKP7WT5U.js"),
    import("./run-QXPYF5RY.js"),
    import("./context-5G352ZUW.js"),
    import("./engine-3XA6WJYR.js")
  ]);
  const configPath = join(primary.root, "config.json");
  const base = await exists(configPath) ? await loadConfig(configPath) : defaultConfig(available[0] ?? "claude");
  const config = { ...base, mode: request.mode ?? base.mode, defaultCli: request.cli ?? base.defaultCli, approvals: request.autoApprove ? "auto" : base.approvals };
  const global = locations.find((location) => location.scope === "global");
  const maxAutonomy = primary.scope === "project" ? (await loadCrewPolicy(global.root)).maxAutonomy : void 0;
  return orchestrate(request.goal, {
    config,
    brain,
    context: { build: (req) => buildContext(brain, req, { eduMdPath }) },
    engines: request.engines ?? createEngine,
    available,
    cwd: request.cwd,
    onEvent: request.onEvent,
    approve: request.approve,
    signal: request.signal,
    harnessLevel: request.harnessLevel,
    playbookName: request.playbook,
    autoApprove: request.autoApprove,
    allowUnregisteredChecks: request.allowUnregisteredChecks,
    ...maxAutonomy ? { maxAutonomy } : {},
    runsDir: join(primary.root, "runs")
  });
}
var exists = (path) => access(path).then(() => true, () => false);

export {
  NO_CLI_MESSAGE,
  runSession
};
//# sourceMappingURL=chunk-5PXHEX27.js.map