import {
  resolveBrainLocations
} from "./chunk-PZTNRBLR.js";
import {
  openBrain
} from "./chunk-NPS5KFAC.js";

// src/cli/workspace.ts
import { access, readFile } from "fs/promises";
import { join } from "path";
async function openWorkspace(ctx, cwd) {
  const env = { ...ctx.env, HOME: ctx.env.HOME ?? ctx.home };
  const locations = await resolveBrainLocations(cwd, env);
  return { locations, primary: locations[0], brain: openBrain(locations) };
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function effectiveConfig(root, detected) {
  const { defaultConfig, loadConfig } = await import("./config-YYK5GJHN.js");
  const path = join(root, "config.json");
  if (await exists(path)) return loadConfig(path);
  return defaultConfig(detected[0] ?? "claude");
}
async function identityName(root) {
  try {
    const text = await readFile(join(root, "EDU.md"), "utf8");
    const heading = /^#\s+(.+?)(?:\s+[—-]\s+.*)?$/m.exec(text)?.[1]?.trim();
    return heading && heading !== "{{name}}" ? heading : "Edu";
  } catch {
    return "Edu";
  }
}
function lessonCount(byStatus) {
  return (byStatus.candidate ?? 0) + (byStatus.proven ?? 0);
}

export {
  openWorkspace,
  exists,
  effectiveConfig,
  identityName,
  lessonCount
};
//# sourceMappingURL=chunk-HKM7MT64.js.map