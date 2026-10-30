import {
  stopsAtCeiling,
  withBrainDir
} from "./chunk-YPR7PZSQ.js";

// src/mcp/locations.ts
import { stat } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
async function resolveBrainLocations(cwd = process.cwd(), env = process.env) {
  const globalRoot = resolve(env.EDU_HOME || join(env.HOME || homedir(), ".edu"));
  const locations = [];
  let current = resolve(cwd);
  while (true) {
    const root = join(current, ".edu");
    try {
      if ((await stat(root)).isDirectory()) {
        locations.push(await withBrainDir({ scope: root === globalRoot ? "global" : "project", root }));
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current || stopsAtCeiling(parent, env)) break;
    current = parent;
  }
  if (!locations.some((location) => location.root === globalRoot)) locations.push(await withBrainDir({ scope: "global", root: globalRoot }));
  return locations;
}

export {
  resolveBrainLocations
};
//# sourceMappingURL=chunk-KQ7WE6FL.js.map