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

export {
  resolveBrainLocations
};
//# sourceMappingURL=chunk-PZTNRBLR.js.map