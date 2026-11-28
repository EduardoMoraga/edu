import {
  whichSync
} from "./chunk-KLV4TDB7.js";

// src/vault/sync-service.ts
import { execFile } from "child_process";
import { access, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { basename, join, resolve } from "path";
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
var CHEIL_VAULT_SYNC_TASK = "CheilVaultSync";
var PREVIOUS_WINDOWS_TASK = "EduSync";
var LEGACY_WINDOWS_TASKS = [CHEIL_VAULT_SYNC_TASK, PREVIOUS_WINDOWS_TASK];
function scheduleIdentity(profileId = "personal") {
  return {
    profileId,
    windowsTask: `EduSync-${profileId}`,
    windowsScript: `edu-sync-${profileId}.cmd`,
    systemdService: `edu-sync-${profileId}.service`,
    systemdTimer: `edu-sync-${profileId}.timer`,
    launchdLabel: `dev.edu.sync.${profileId}`,
    launchdPlist: `dev.edu.sync.${profileId}.plist`
  };
}
function defaultSyncMinutes(profileId = "personal") {
  return profileId === "cheil" ? 15 : 5;
}
function scheduleUnitName(kind, profileId = "personal") {
  const identity = scheduleIdentity(profileId);
  if (kind === "schtasks") return identity.windowsTask;
  if (kind === "launchd") return identity.launchdLabel;
  return identity.systemdService.replace(/\.service$/, "");
}
function windowsTask(options) {
  const identity = scheduleIdentity(options.profileId);
  const minutes = options.minutes ?? defaultSyncMinutes(identity.profileId);
  const script = join(options.eduHome ?? join(options.home, ".edu"), identity.windowsScript);
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
    create: ["/Create", "/F", "/TN", identity.windowsTask, "/SC", "MINUTE", "/MO", String(minutes), "/TR", `"${script}"`],
    remove: ["/Delete", "/F", "/TN", identity.windowsTask],
    query: ["/Query", "/TN", identity.windowsTask]
  };
}
function scheduleFiles(home, eduHome, platform, profileId = "personal") {
  const identity = scheduleIdentity(profileId);
  if (platform === "linux") {
    const dir = join(home, ".config", "systemd", "user");
    return { kind: "systemd", files: [join(dir, identity.systemdService), join(dir, identity.systemdTimer)] };
  }
  if (platform === "darwin") return { kind: "launchd", files: [join(home, "Library", "LaunchAgents", identity.launchdPlist)] };
  return platform === "win32" ? { kind: "schtasks", files: [join(eduHome ?? join(home, ".edu"), identity.windowsScript)] } : void 0;
}
async function installSchedule(options) {
  const platform = options.platform ?? process.platform;
  const call = options.run ?? run;
  const identity = scheduleIdentity(options.profileId);
  const legacy = await legacySchedules(options);
  const minutes = options.minutes ?? defaultSyncMinutes(identity.profileId);
  const path = options.path ?? process.env.PATH ?? "/usr/bin:/bin";
  const extra = (options.args ?? []).map((arg) => ` ${arg}`).join("");
  const env = Object.entries(options.env ?? {});
  if (platform === "linux") {
    const dir = join(options.home, ".config", "systemd", "user");
    await mkdir(dir, { recursive: true });
    const service = join(dir, identity.systemdService);
    const timer = join(dir, identity.systemdTimer);
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
    const started = await call("systemctl", ["--user", "daemon-reload"]) === 0 && await call("systemctl", ["--user", "enable", "--now", identity.systemdTimer]) === 0;
    return { kind: "systemd", files: [service, timer], started, legacy };
  }
  if (platform === "darwin") {
    const dir = join(options.home, "Library", "LaunchAgents");
    await mkdir(dir, { recursive: true });
    const plist = join(dir, identity.launchdPlist);
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const vars = [["PATH", path], ...env].map(([key, value]) => `<key>${esc(key)}</key><string>${esc(value)}</string>`).join("");
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${identity.launchdLabel}</string>
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
    await call("launchctl", ["unload", plist]);
    const started = await call("launchctl", ["load", "-w", plist]) === 0;
    return { kind: "launchd", files: [plist], started, legacy };
  }
  if (platform === "win32") {
    const task = windowsTask({ ...options, minutes });
    await mkdir(join(task.script, ".."), { recursive: true });
    await writeFile(task.script, task.content);
    const started = await call("schtasks", task.create) === 0;
    return { kind: "schtasks", files: [task.script], started, legacy };
  }
  throw new Error(`scheduled sync is not supported on ${platform}; run \`edu sync\` from your own scheduler`);
}
async function uninstallSchedule(options) {
  const call = options.run ?? run;
  const platform = options.platform ?? process.platform;
  const identity = scheduleIdentity(options.profileId);
  const known = scheduleFiles(options.home, options.eduHome, platform, identity.profileId);
  if (!known) throw new Error(`scheduled sync is not supported on ${platform}`);
  let stopped = true;
  if (known.kind === "systemd") stopped = await call("systemctl", ["--user", "disable", "--now", identity.systemdTimer]) === 0;
  if (known.kind === "launchd") stopped = await call("launchctl", ["unload", "-w", known.files[0]]) === 0;
  if (known.kind === "schtasks") stopped = await call("schtasks", windowsTask({ home: options.home, eduHome: options.eduHome, node: "", cli: "", profileId: identity.profileId }).remove) === 0;
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
  const identity = scheduleIdentity(options.profileId);
  const known = scheduleFiles(options.home, options.eduHome, platform, identity.profileId);
  if (!known) return { installed: false, files: [], legacy: [] };
  const present = [];
  for (const file of known.files) if (await exists(file)) present.push(file);
  const installed = known.kind === "schtasks" ? await (options.run ?? run)("schtasks", windowsTask({ home: options.home, eduHome: options.eduHome, node: "", cli: "", profileId: identity.profileId }).query) === 0 : present.length === known.files.length;
  return { kind: known.kind, installed, files: present, legacy: await legacySchedules(options) };
}
function taskName(entry) {
  return !entry.includes("/") && !entry.includes("\\");
}
async function legacySchedules(options) {
  const platform = options.platform ?? process.platform;
  const identity = scheduleIdentity(options.profileId);
  if (platform === "win32") {
    const call = options.run ?? run;
    const found2 = [];
    for (const name of LEGACY_WINDOWS_TASKS) {
      if (await call("schtasks", ["/Query", "/TN", name]) === 0) found2.push(name);
    }
    return found2;
  }
  if (platform !== "darwin" && platform !== "linux") return [];
  const dir = platform === "darwin" ? join(options.home, "Library", "LaunchAgents") : join(options.home, ".config", "systemd", "user");
  const entries = await readdir(dir).catch(() => []);
  const suffix = platform === "darwin" ? ".plist" : ".service";
  const own = platform === "darwin" ? identity.launchdPlist : identity.systemdService;
  const named = new Set(platform === "darwin" ? ["dev.edu.sync.plist", "CheilVaultSync.plist"] : ["edu-sync.service", "CheilVaultSync.service"]);
  const vault = options.vault ? resolve(options.vault) : void 0;
  const found = [];
  for (const name of entries) {
    if (name === own) continue;
    const file = join(dir, name);
    if (named.has(name)) {
      found.push(file);
      continue;
    }
    if (!name.endsWith(suffix)) continue;
    const content = await readFile(file, "utf8").catch(() => "");
    const command = platform === "darwin" ? /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(content)?.[1] ?? "" : /^ExecStart=(.*)$/m.exec(content)?.[1] ?? "";
    const vaultPattern = vault ? new RegExp(`${vault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/\\s<>"']|$)`) : void 0;
    if (/(?:^|[\s/"<>])[^\s/"<>]*-vault-sync(?:\.[\w-]+)?(?:[\s/"<>]|$)/.test(command) || vaultPattern?.test(command)) found.push(file);
  }
  return found.sort();
}
async function replaceLegacySchedules(options) {
  const platform = options.platform ?? process.platform;
  const call = options.run ?? run;
  const found = await legacySchedules(options);
  const removed = [];
  for (const file of found) {
    if (taskName(file)) {
      if (await call("schtasks", ["/Delete", "/F", "/TN", file]) === 0) removed.push(file);
      continue;
    }
    if (platform === "darwin") await call("launchctl", ["unload", "-w", file]);
    else {
      const unit = basename(file);
      const timer = join(file, "..", unit.replace(/\.service$/, ".timer"));
      await call("systemctl", ["--user", "disable", "--now", basename(timer)]);
      if (await exists(timer)) {
        await rm(timer);
        removed.push(timer);
      }
      await call("systemctl", ["--user", "stop", unit]);
    }
    await rm(file);
    removed.push(file);
  }
  if (removed.length && platform === "linux") await call("systemctl", ["--user", "daemon-reload"]);
  return removed;
}

export {
  notify,
  defaultSyncMinutes,
  scheduleUnitName,
  scheduleFiles,
  installSchedule,
  uninstallSchedule,
  scheduleStatus,
  legacySchedules,
  replaceLegacySchedules
};
//# sourceMappingURL=chunk-OUJLA7GR.js.map