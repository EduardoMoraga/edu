import {
  createEduMcpServer
} from "./chunk-6GLGLLOK.js";
import {
  selectWorkspace
} from "./chunk-SNDHWENC.js";
import {
  getCapabilities
} from "./chunk-W7AWSQHQ.js";
import "./chunk-UPSPAYW3.js";
import "./chunk-SHLHBIR7.js";
import "./chunk-KQPRJ5HL.js";
import "./chunk-PSPSPPGI.js";
import "./chunk-X4DEIY6R.js";
import "./chunk-RJR54O7G.js";
import "./chunk-753L45FB.js";
import "./chunk-FMFRO2B7.js";
import {
  resolveBrainLocations
} from "./chunk-ORYLFQE5.js";
import "./chunk-AINX4RRX.js";
import "./chunk-XEODSS5O.js";
import "./chunk-3U3ZYT3I.js";
import "./chunk-CAQVQMTA.js";
import "./chunk-6GXTQRCF.js";
import "./chunk-LVU7A3FM.js";
import "./chunk-KLV4TDB7.js";
import {
  openBrain
} from "./chunk-BDQUVGCN.js";
import "./chunk-KDSAKUP2.js";
import "./chunk-NMJNTHQG.js";
import "./chunk-2KR4L72V.js";
import "./chunk-ICQNXX6J.js";
import "./chunk-ZJAEVUE2.js";
import "./chunk-NYX2D5YD.js";
import "./chunk-YINGR2DA.js";
import "./chunk-YPR7PZSQ.js";
import "./chunk-VP6QM6H5.js";

// src/mcp/stdio.ts
import { existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
async function runStdioServer(opts = {}) {
  const server = await createStdioServer(opts);
  await server.connect(new StdioServerTransport());
  return server;
}
async function createStdioServer(opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? launchDirectory(env);
  const profile = opts.toolProfile ?? env.EDU_MCP_PROFILE ?? "full";
  if (profile !== "full" && profile !== "memory") throw new Error("Unknown MCP tool profile; use full or memory");
  const capabilities = () => JSON.stringify({ ...getCapabilities(), toolProfile: profile });
  const workspaceLocked = env.EDU_LOCK_WORKSPACE === "1";
  const project = workspaceLocked ? void 0 : opts.project?.trim() || env.EDU_PROJECT?.trim() || void 0;
  if (project) {
    const selection = await selectWorkspace(project, env, cwd, { create: true });
    return createEduMcpServer({
      locations: selection.locations,
      now: opts.now,
      env,
      workspace: selection.root ?? "global",
      capabilities,
      toolProfile: profile,
      eduMdPath: join(selection.locations[0].root, "EDU.md")
    });
  }
  const locations = await resolveBrainLocations(cwd, env);
  const brain = openBrain(locations);
  await brain.init(locations[0]);
  return createEduMcpServer({
    locations,
    now: opts.now,
    env,
    capabilities,
    toolProfile: profile,
    workspaceLocked,
    eduMdPath: join(locations[0].root, "EDU.md"),
    resolveLocations: async (mcp) => {
      if (workspaceLocked) return void 0;
      if (!mcp.server.getClientCapabilities()?.roots) return void 0;
      return resolveReboundLocations(cwd, env, async () => (await mcp.server.listRoots()).roots.map((root) => root.uri));
    }
  });
}
var RootsNotReady = class extends Error {
  constructor() {
    super("MCP client roots are not available yet");
  }
};
async function resolveReboundLocations(cwd, env, listRoots) {
  let roots;
  try {
    roots = await listRoots();
  } catch {
    roots = await listRoots();
  }
  const uri = roots.find((root) => root.startsWith("file://"));
  if (!uri) throw new RootsNotReady();
  const dir = resolve(fileURLToPath(uri));
  if (dir === resolve(cwd)) return void 0;
  return resolveBrainLocations(dir, env);
}
function launchDirectory(env, processCwd = process.cwd()) {
  const pwd = env.PWD;
  if (pwd && resolve(pwd) !== resolve(processCwd) && existsSync(pwd) && statSync(pwd).isDirectory() && /[\\/]plugins?[\\/]/.test(processCwd)) return pwd;
  return processCwd;
}
export {
  RootsNotReady,
  createStdioServer,
  launchDirectory,
  resolveReboundLocations,
  runStdioServer
};
//# sourceMappingURL=stdio-CLHER763.js.map