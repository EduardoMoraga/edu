import {
  createEduMcpServer
} from "./chunk-BKFAHX6J.js";
import "./chunk-FHELKHC4.js";
import "./chunk-VXRMRQCF.js";
import "./chunk-JP6AHW2T.js";
import "./chunk-EL5RUSGC.js";
import "./chunk-D45JK3LN.js";
import "./chunk-5G4RNW33.js";
import "./chunk-6GXTQRCF.js";
import "./chunk-DGRJ2CUR.js";
import "./chunk-PGQM5MLC.js";
import "./chunk-QNEUTXM7.js";
import "./chunk-2IXDUF7Q.js";
import {
  selectWorkspace
} from "./chunk-C6ZBPP2X.js";
import {
  getCapabilities
} from "./chunk-ZFF2VUTT.js";
import "./chunk-BXZ573JQ.js";
import "./chunk-RWOFVLBN.js";
import "./chunk-C4BNEOC5.js";
import "./chunk-VHSIB24T.js";
import "./chunk-UYYHIVGH.js";
import {
  resolveBrainLocations
} from "./chunk-KQ7WE6FL.js";
import {
  openBrain
} from "./chunk-KWXFE3IE.js";
import "./chunk-UKZFPABF.js";
import "./chunk-5SCDNPRR.js";
import "./chunk-I6JWASFE.js";
import "./chunk-GPKNRNOP.js";
import "./chunk-YPR7PZSQ.js";

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
    const selection = await selectWorkspace(project, env, cwd);
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
async function resolveReboundLocations(cwd, env, listRoots) {
  let roots;
  try {
    roots = await listRoots();
  } catch {
    roots = await listRoots();
  }
  const uri = roots.find((root) => root.startsWith("file://"));
  if (!uri) return void 0;
  const dir = resolve(fileURLToPath(uri));
  if (dir === resolve(cwd)) return void 0;
  const locations = await resolveBrainLocations(dir, env);
  if (locations[0]?.scope !== "project" && !locations.some((location) => location.root === join(dir, ".edu"))) locations.unshift({ scope: "project", root: join(dir, ".edu") });
  await openBrain(locations).init(locations[0]);
  return locations;
}
function launchDirectory(env, processCwd = process.cwd()) {
  const pwd = env.PWD;
  if (pwd && resolve(pwd) !== resolve(processCwd) && existsSync(pwd) && statSync(pwd).isDirectory() && /[\\/]plugins?[\\/]/.test(processCwd)) return pwd;
  return processCwd;
}
export {
  createStdioServer,
  launchDirectory,
  resolveReboundLocations,
  runStdioServer
};
//# sourceMappingURL=stdio-IOZSYZHH.js.map