import {
  resolveBrainLocations
} from "./chunk-ORYLFQE5.js";
import {
  openBrain
} from "./chunk-BDQUVGCN.js";

// src/cli/workspace.ts
import { access } from "fs/promises";
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
function lessonCount(byStatus) {
  return (byStatus.candidate ?? 0) + (byStatus.proven ?? 0);
}

export {
  openWorkspace,
  exists,
  lessonCount
};
//# sourceMappingURL=chunk-RAL3CFMO.js.map