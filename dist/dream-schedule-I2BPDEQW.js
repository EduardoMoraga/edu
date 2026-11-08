// src/reflect/dream-schedule.ts
import { execFile } from "child_process";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
var exec = (cmd, args) => new Promise((done) => execFile(cmd, args, { timeout: 1e4 }, (error) => done(error ? 1 : 0)));
var dreamCronLine = (o) => `${o.minute ?? 30} ${o.hour ?? 3} * * * ${JSON.stringify(o.node)} ${JSON.stringify(o.cli)} --cwd ${JSON.stringify(o.cwd)} dream`;
async function installDreamSchedule(options) {
  const platform = options.platform ?? process.platform;
  const hour = options.hour ?? 3, minute = options.minute ?? 30;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("The dream schedule needs an hour 0-23 and a minute 0-59.");
  const run = options.run ?? exec;
  const path = options.path ?? process.env.PATH ?? "/usr/bin:/bin";
  const name = `edu-dream-${createHash("sha256").update(options.cwd).digest("hex").slice(0, 8)}`;
  const at = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (platform === "linux") {
    const dir = join(options.home, ".config", "systemd", "user");
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
    const dir = join(options.home, "Library", "LaunchAgents");
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
  installDreamSchedule
};
//# sourceMappingURL=dream-schedule-I2BPDEQW.js.map