import {
  whichSync
} from "./chunk-VHSIB24T.js";

// src/vault/sync-service.ts
import { execFile } from "child_process";
import { access, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
var run = (cmd, args) => new Promise((done) => execFile(cmd, args, { timeout: 1e4, windowsHide: true }, (error) => done(error ? 1 : 0)));
var exists = (path) => access(path).then(() => true, () => false);
async function notify(title, body, platform = process.platform) {
  if (platform === "darwin") {
    const quote = (s) => JSON.stringify(s);
    await run("osascript", ["-e", `display notification ${quote(body)} with title ${quote(title)}`]);
  } else if (platform === "linux" && whichSync("notify-send")) {
    await run("notify-send", ["-u", "critical", "-a", "Edu", title, body]);
  }
}
var WINDOWS_TASK = "EduSync";
function windowsTask(options) {
  const minutes = options.minutes ?? 5;
  const script = join(options.eduHome ?? join(options.home, ".edu"), "edu-sync.cmd");
  const batch = (s) => s.replace(/%/g, "%%");
  const content = [
    "@echo off",
    ...Object.entries(options.env ?? {}).map(([key, value]) => `set "${key}=${batch(value)}"`),
    `"${batch(options.node)}" "${batch(options.cli)}" sync --reason timer${(options.args ?? []).map((arg) => ` ${batch(arg)}`).join("")}`,
    ""
  ].join("\r\n");
  return {
    script,
    content,
    // No /RU: the task runs as the current user, only while that user is logged on (no stored password).
    create: ["/Create", "/F", "/TN", WINDOWS_TASK, "/SC", "MINUTE", "/MO", String(minutes), "/TR", `"${script}"`],
    remove: ["/Delete", "/F", "/TN", WINDOWS_TASK],
    query: ["/Query", "/TN", WINDOWS_TASK]
  };
}
function scheduleFiles(home, eduHome, platform) {
  if (platform === "linux") {
    const dir = join(home, ".config", "systemd", "user");
    return { kind: "systemd", files: [join(dir, "edu-sync.service"), join(dir, "edu-sync.timer")] };
  }
  if (platform === "darwin") return { kind: "launchd", files: [join(home, "Library", "LaunchAgents", "dev.edu.sync.plist")] };
  if (platform === "win32") return { kind: "schtasks", files: [join(eduHome ?? join(home, ".edu"), "edu-sync.cmd")] };
  return void 0;
}
async function installSchedule(options) {
  const platform = options.platform ?? process.platform;
  const minutes = options.minutes ?? 5;
  const path = options.path ?? process.env.PATH ?? "/usr/bin:/bin";
  const extra = (options.args ?? []).map((arg) => ` ${arg}`).join("");
  const env = Object.entries(options.env ?? {});
  if (platform === "linux") {
    const dir = join(options.home, ".config", "systemd", "user");
    await mkdir(dir, { recursive: true });
    const service = join(dir, "edu-sync.service");
    const timer = join(dir, "edu-sync.timer");
    await writeFile(service, [
      "[Unit]",
      "Description=Edu: sync the shared brain with GitHub",
      "",
      "[Service]",
      "Type=oneshot",
      `Environment=PATH=${path}`,
      ...env.map(([key, value]) => `Environment=${key}=${value}`),
      `ExecStart=${options.node} ${options.cli} sync --reason timer${extra}`,
      ""
    ].join("\n"));
    await writeFile(timer, [
      "[Unit]",
      `Description=Edu: sync the shared brain every ${minutes} minutes`,
      "",
      "[Timer]",
      "OnBootSec=1min",
      `OnUnitActiveSec=${minutes}min`,
      "Persistent=true",
      "",
      "[Install]",
      "WantedBy=timers.target",
      ""
    ].join("\n"));
    const started = await run("systemctl", ["--user", "daemon-reload"]) === 0 && await run("systemctl", ["--user", "enable", "--now", "edu-sync.timer"]) === 0;
    return { kind: "systemd", files: [service, timer], started };
  }
  if (platform === "darwin") {
    const dir = join(options.home, "Library", "LaunchAgents");
    await mkdir(dir, { recursive: true });
    const plist = join(dir, "dev.edu.sync.plist");
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const vars = [["PATH", path], ...env].map(([key, value]) => `<key>${esc(key)}</key><string>${esc(value)}</string>`).join("");
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.edu.sync</string>
  <key>ProgramArguments</key><array>
    <string>${esc(options.node)}</string><string>${esc(options.cli)}</string>
    <string>sync</string><string>--reason</string><string>timer</string>${(options.args ?? []).map((arg) => `<string>${esc(arg)}</string>`).join("")}
  </array>
  <key>EnvironmentVariables</key><dict>${vars}</dict>
  <key>StartInterval</key><integer>${minutes * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`);
    await run("launchctl", ["unload", plist]);
    const started = await run("launchctl", ["load", "-w", plist]) === 0;
    return { kind: "launchd", files: [plist], started };
  }
  if (platform === "win32") {
    const task = windowsTask({ ...options, minutes });
    await mkdir(join(task.script, ".."), { recursive: true });
    await writeFile(task.script, task.content);
    const started = await run("schtasks", task.create) === 0;
    return { kind: "schtasks", files: [task.script], started };
  }
  throw new Error(`scheduled sync is not supported on ${platform}; run \`edu sync\` from your own scheduler`);
}
async function uninstallSchedule(options) {
  const call = options.run ?? run;
  const platform = options.platform ?? process.platform;
  const known = scheduleFiles(options.home, options.eduHome, platform);
  if (!known) throw new Error(`scheduled sync is not supported on ${platform}`);
  let stopped = true;
  if (known.kind === "systemd") stopped = await call("systemctl", ["--user", "disable", "--now", "edu-sync.timer"]) === 0;
  if (known.kind === "launchd") stopped = await call("launchctl", ["unload", "-w", known.files[0]]) === 0;
  if (known.kind === "schtasks") stopped = await call("schtasks", windowsTask({ home: options.home, eduHome: options.eduHome, node: "", cli: "" }).remove) === 0;
  const removed = [];
  for (const file of known.files) if (await exists(file)) {
    await rm(file, { force: true });
    removed.push(file);
  }
  if (known.kind === "systemd") await call("systemctl", ["--user", "daemon-reload"]);
  return { kind: known.kind, removed, stopped };
}
async function scheduleStatus(options) {
  const platform = options.platform ?? process.platform;
  const known = scheduleFiles(options.home, options.eduHome, platform);
  if (!known) return { installed: false, files: [] };
  const present = [];
  for (const file of known.files) if (await exists(file)) present.push(file);
  const installed = known.kind === "schtasks" ? await run("schtasks", windowsTask({ home: options.home, eduHome: options.eduHome, node: "", cli: "" }).query) === 0 : present.length === known.files.length;
  return { kind: known.kind, installed, files: present };
}

export {
  notify,
  scheduleFiles,
  installSchedule,
  uninstallSchedule,
  scheduleStatus
};
//# sourceMappingURL=chunk-SVIWNIHV.js.map