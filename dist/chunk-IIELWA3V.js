import {
  openBrain
} from "./chunk-3FSLIEUM.js";

// src/mcp/locations.ts
import { stat } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
async function resolveBrainLocations(cwd = process.cwd(), env = process.env) {
  const locations = [];
  let current = resolve(cwd);
  while (true) {
    const root = join(current, ".edu");
    try {
      if ((await stat(root)).isDirectory()) {
        locations.push({ scope: "project", root });
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const globalRoot = resolve(env.EDU_HOME || join(env.HOME || homedir(), ".edu"));
  if (!locations.some((location) => location.root === globalRoot)) locations.push({ scope: "global", root: globalRoot });
  return locations;
}

// src/cli/workspace.ts
import { access, readFile } from "fs/promises";
import { join as join2 } from "path";
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
  const { defaultConfig, loadConfig } = await import("./config-IXILFO2I.js");
  const path = join2(root, "config.json");
  if (await exists(path)) return loadConfig(path);
  return defaultConfig(detected[0] ?? "claude");
}
async function identityName(root) {
  try {
    const text = await readFile(join2(root, "EDU.md"), "utf8");
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
  resolveBrainLocations,
  openWorkspace,
  exists,
  effectiveConfig,
  identityName,
  lessonCount
};
//# sourceMappingURL=chunk-IIELWA3V.js.map