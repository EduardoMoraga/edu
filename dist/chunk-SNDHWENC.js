import {
  resolveBrainLocations
} from "./chunk-ORYLFQE5.js";
import {
  openBrain
} from "./chunk-BDQUVGCN.js";
import {
  readProjects
} from "./chunk-KDSAKUP2.js";
import {
  readWorkspaceSettings,
  withBrainDir
} from "./chunk-YPR7PZSQ.js";

// src/mcp/projects.ts
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";
function eduHomeOf(env) {
  return resolve(env.EDU_HOME || join(env.HOME || homedir(), ".edu"));
}
async function listWorkspaces(env) {
  const { projects } = await readProjects(eduHomeOf(env));
  return Promise.all(projects.map(async (entry) => {
    const present = existsSync(join(entry.root, ".edu"));
    const agent = present ? (await readWorkspaceSettings(join(entry.root, ".edu"))).identity?.name ?? "Edu" : "Edu";
    return { name: entry.name, agent, root: entry.root, present };
  }));
}
var GLOBAL = /* @__PURE__ */ new Set(["global", "~", "edu-home"]);
var looksLikePath = (selector) => isAbsolute(selector) || selector.startsWith(".") || selector.startsWith("~/") || /[\\/]/.test(selector);
async function selectWorkspace(selector, env, cwd = process.cwd(), options = {}) {
  const wanted = selector.trim();
  if (!wanted) throw new Error("Workspace selector must not be empty");
  const home = eduHomeOf(env);
  if (GLOBAL.has(wanted.toLowerCase())) {
    return { label: "global", root: void 0, locations: [await withBrainDir({ scope: "global", root: home })] };
  }
  let root;
  let label = wanted;
  if (looksLikePath(wanted)) {
    const path = wanted.startsWith("~/") ? join(env.HOME || homedir(), wanted.slice(2)) : resolve(cwd, wanted);
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Workspace folder not found: ${path}`);
    if (!options.create && !isDirectory(join(path, ".edu"))) throw new Error(`Not an Edu workspace: ${path}. Pick a registered workspace (edu_projects) or a folder that already has a .edu brain; create one with \`edu init\` there.`);
    root = path;
  } else {
    const workspaces = await listWorkspaces(env);
    const lower = wanted.toLowerCase();
    const byName = workspaces.find((w) => w.name.toLowerCase() === lower);
    const byAgent = workspaces.filter((w) => w.agent.toLowerCase() === lower);
    const match = byName ?? (byAgent.length === 1 ? byAgent[0] : void 0);
    if (!match) {
      const known = workspaces.map((w) => `${w.name} (${w.agent})`).join(", ") || "none registered";
      const why = byAgent.length > 1 ? `"${wanted}" is the agent of several workspaces; use the workspace name` : `Unknown workspace "${wanted}"`;
      throw new Error(`${why}. Registered: ${known}`);
    }
    if (!match.present) throw new Error(`Workspace ${match.name} is registered but missing: ${match.root}`);
    root = match.root;
    label = match.name;
  }
  const locations = await resolveBrainLocations(root, env);
  if (!options.create) return { label, root: dirname(locations[0].root), locations };
  if (locations[0]?.scope !== "project" && !locations.some((location) => location.root === join(root, ".edu"))) locations.unshift({ scope: "project", root: join(root, ".edu") });
  await openBrain(locations).init(locations[0]);
  return { label, root: dirname(locations[0].root), locations };
}
var isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export {
  eduHomeOf,
  listWorkspaces,
  selectWorkspace
};
//# sourceMappingURL=chunk-SNDHWENC.js.map