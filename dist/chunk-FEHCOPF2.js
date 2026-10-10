// src/platform/index.ts
import crossSpawn from "cross-spawn";
var spawnCli = crossSpawn;
function eduMcpLaunch(platform = process.platform) {
  return platform === "win32" ? { command: "cmd", args: ["/c", "edu", "mcp"] } : { command: "edu", args: ["mcp"] };
}

export {
  spawnCli,
  eduMcpLaunch
};
//# sourceMappingURL=chunk-FEHCOPF2.js.map