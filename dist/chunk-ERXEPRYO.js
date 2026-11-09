// src/reflect/dream-schedule.ts
import { execFile } from "child_process";
import { createHash } from "crypto";
import { access, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
var exec = (cmd, args) => new Promise((done) => execFile(cmd, args, { timeout: 1e4 }, (error) => done(error ? 1 : 0)));
var dreamCronLine = (o) => `${o.minute ?? 30} ${o.hour ?? 3} * * * ${JSON.stringify(o.node)} ${JSON.stringify(o.cli)} --cwd ${JSON.stringify(o.cwd)} dream`;
var dreamScheduleName = (cwd) => `edu-dream-${createHash("sha256").update(cwd).digest("hex").slice(0, 8)}`;
var unitDir = (home) => join(home, ".config", "systemd", "user");
var agentDir = (home) => join(home, "Library", "LaunchAgents");
var DREAM_NAME = /^edu-dream-[0-9a-f]+$/;
var dreamRegistryPath = (eduHome) => join(eduHome, "state", "dream-schedules.json");
async function readRegistry(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed.schedules) ? parsed.schedules.filter((s) => Boolean(s) && typeof s.name === "string" && DREAM_NAME.test(s.name) && (s.kind === "systemd" || s.kind === "launchd") && Array.isArray(s.files)) : [];
  } catch {
    return [];
  }
}
async function writeRegistry(path, schedules) {
  if (!schedules.length) {
    await rm(path, { force: true });
    await rmdir(dirname(path)).catch(() => void 0);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ version: 1, schedules }, null, 2)}
`);
  await rename(temp, path);
}
async function record(eduHome, entry) {
  const path = dreamRegistryPath(eduHome);
  const schedules = (await readRegistry(path)).filter((s) => s.name !== entry.name);
  await writeRegistry(path, [...schedules, entry]);
}
async function installDreamSchedule(options) {
  const result = await writeDreamSchedule(options);
  await record(options.eduHome ?? join(options.home, ".edu"), { kind: result.kind, name: result.name, cwd: options.cwd, files: result.files });
  return result;
}
var present = async (dir) => readdir(dir).catch(() => []);
async function uninstallDreamSchedules(options) {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? exec;
  const registryPath = dreamRegistryPath(options.eduHome ?? join(options.home, ".edu"));
  const recorded = await readRegistry(registryPath);
  const only = options.cwd === void 0 ? void 0 : dreamScheduleName(options.cwd);
  const wanted = (name) => only === void 0 || name === only;
  const targets = /* @__PURE__ */ new Map();
  for (const entry of recorded) if (wanted(entry.name)) targets.set(entry.name, entry.kind);
  if (platform === "linux") {
    for (const file of await present(unitDir(options.home))) {
      const match = /^(edu-dream-[0-9a-f]+)\.(?:service|timer)$/.exec(file);
      if (match && wanted(match[1])) targets.set(match[1], "systemd");
    }
  }
  if (platform === "darwin") {
    for (const file of await present(agentDir(options.home))) {
      const match = /^dev\.edu\.(edu-dream-[0-9a-f]+)\.plist$/.exec(file);
      if (match && wanted(match[1])) targets.set(match[1], "launchd");
    }
  }
  const results = [];
  let reload = false;
  for (const [name, kind] of targets) {
    const files = kind === "systemd" ? [join(unitDir(options.home), `${name}.service`), join(unitDir(options.home), `${name}.timer`)] : [join(agentDir(options.home), `dev.edu.${name}.plist`)];
    const existing = [];
    for (const file of files) if (await access(file).then(() => true, () => false)) existing.push(file);
    let stopped = true;
    if (existing.length) {
      if (kind === "systemd") stopped = await run("systemctl", ["--user", "disable", "--now", `${name}.timer`]) === 0;
      else for (const plist of existing) stopped = await run("launchctl", ["unload", "-w", plist]) === 0 && stopped;
      for (const file of existing) await rm(file, { force: true });
      if (kind === "systemd") reload = true;
      results.push({ kind, name, removed: existing, stopped });
    }
  }
  if (reload) await run("systemctl", ["--user", "daemon-reload"]);
  const left = recorded.filter((entry) => !wanted(entry.name));
  if (left.length !== recorded.length) await writeRegistry(registryPath, left);
  return results;
}
async function writeDreamSchedule(options) {
  const platform = options.platform ?? process.platform;
  const hour = options.hour ?? 3, minute = options.minute ?? 30;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("The dream schedule needs an hour 0-23 and a minute 0-59.");
  const run = options.run ?? exec;
  const path = options.path ?? process.env.PATH ?? "/usr/bin:/bin";
  const name = dreamScheduleName(options.cwd);
  const at = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (platform === "linux") {
    const dir = unitDir(options.home);
    await mkdir(dir, { recursive: true });
    const service = join(dir, `${name}.service`), timer = join(dir, `${name}.timer`);
    const quote = (value) => `"${value.replace(/(["\\])/g, "\\$1")}"`;
    await writeFile(service, [
      "[Unit]",
      `Description=Edu: nightly dream plan for ${options.cwd}`,
      "",
      "[Service]",
      "Type=oneshot",
      `Environment=PATH=${path}`,
      `WorkingDirectory=${options.cwd}`,
      `ExecStart=${quote(options.node)} ${quote(options.cli)} --cwd ${quote(options.cwd)} dream`,
      ""
    ].join("\n"));
    await writeFile(timer, [
      "[Unit]",
      `Description=Edu: dream every night at ${at}`,
      "",
      "[Timer]",
      `OnCalendar=*-*-* ${at}:00`,
      "Persistent=true",
      "",
      "[Install]",
      "WantedBy=timers.target",
      ""
    ].join("\n"));
    const started = await run("systemctl", ["--user", "daemon-reload"]) === 0 && await run("systemctl", ["--user", "enable", "--now", `${name}.timer`]) === 0;
    return { kind: "systemd", name, files: [service, timer], started };
  }
  if (platform === "darwin") {
    const dir = agentDir(options.home);
    await mkdir(dir, { recursive: true });
    const label = `dev.edu.${name}`;
    const plist = join(dir, `${label}.plist`);
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(options.node)}</string><string>${esc(options.cli)}</string>
    <string>--cwd</string><string>${esc(options.cwd)}</string><string>dream</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(path)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`);
    await run("launchctl", ["unload", plist]);
    const started = await run("launchctl", ["load", "-w", plist]) === 0;
    return { kind: "launchd", name, files: [plist], started };
  }
  throw new Error(`A nightly dream is not installed on ${platform}. Schedule this command yourself: ${dreamCronLine({ ...options, hour, minute })}`);
}

export {
  dreamCronLine,
  dreamScheduleName,
  dreamRegistryPath,
  installDreamSchedule,
  uninstallDreamSchedules
};
//# sourceMappingURL=chunk-ERXEPRYO.js.map