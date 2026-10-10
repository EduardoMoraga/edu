// src/platform/index.ts
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { delimiter, dirname, extname, join, resolve } from "path";
import crossSpawn from "cross-spawn";
function whichSync(name, env = process.env, platform = process.platform) {
  const exts = platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const hasExt = platform === "win32" && extname(name) !== "";
  for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : delimiter)) {
    if (!dir) continue;
    for (const ext of hasExt ? [""] : exts) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return void 0;
}
function nodeScriptFromCmdShim(shimPath, content) {
  const text = content ?? readFileSync(shimPath, "utf8");
  const match = /"%(?:~?dp0)%?\\([^"]+?\.(?:js|mjs|cjs))"/i.exec(text) ?? /%~dp0\\([^\s"]+?\.(?:js|mjs|cjs))/i.exec(text);
  if (!match?.[1]) return void 0;
  return resolve(dirname(shimPath), match[1].replace(/\\/g, "/"));
}
function exeFromCmdShim(shimPath, content) {
  const text = content ?? readFileSync(shimPath, "utf8");
  const match = /"%(?:~?dp0)%?\\([^"]+?\.exe)"/i.exec(text);
  return match?.[1] ? resolve(dirname(shimPath), match[1].replace(/\\/g, "/")) : void 0;
}
function resolveCommand(command, args, env = process.env, platform = process.platform) {
  if (platform !== "win32") return { command, args, direct: false };
  const found = whichSync(command, env, platform);
  if (!found) return { command, args, direct: false };
  const ext = extname(found).toLowerCase();
  if (ext === ".exe" || ext === ".com") return { command: found, args, direct: true };
  if (ext === ".cmd" || ext === ".bat") {
    const script = nodeScriptFromCmdShim(found);
    if (script && existsSync(script)) return { command: process.execPath, args: [script, ...args], direct: true };
    const binary = exeFromCmdShim(found);
    if (binary && existsSync(binary)) return { command: binary, args, direct: true };
  }
  return { command, args, direct: false };
}
function spawnCli(command, args, options = {}) {
  const env = options.env ?? process.env;
  const resolved = resolveCommand(command, [...args], env);
  if (resolved.direct) return spawn(resolved.command, resolved.args, { ...options, windowsHide: true });
  return crossSpawn(command, [...args], options);
}
function eduMcpLaunch(platform = process.platform) {
  return platform === "win32" ? { command: "cmd", args: ["/c", "edu", "mcp"] } : { command: "edu", args: ["mcp"] };
}

export {
  spawnCli,
  eduMcpLaunch
};
//# sourceMappingURL=chunk-B5FNIIOI.js.map