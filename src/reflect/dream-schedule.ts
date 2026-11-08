/**
 * `edu dream --install`: a nightly, per-user schedule that writes a fresh dream plan (never applies it).
 * Same approach as `edu sync --install` (systemd user timer on Linux, LaunchAgent on macOS), with one job per
 * project so several brains can dream on the same machine. The scheduled run is deterministic: no model, no cost.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DreamScheduleOptions {
  home: string;
  node: string;
  cli: string;
  /** Project directory the job runs in (`edu --cwd <dir> dream`). */
  cwd: string;
  hour?: number;
  minute?: number;
  path?: string;
  platform?: NodeJS.Platform;
  /** Runs systemctl/launchctl; injectable so tests never touch the real service manager. */
  run?: (cmd: string, args: string[]) => Promise<number>;
}
export interface DreamScheduleResult { kind: 'systemd' | 'launchd'; name: string; files: string[]; started: boolean }

const exec = (cmd: string, args: string[]) => new Promise<number>(done => execFile(cmd, args, { timeout: 10_000 }, error => done(error ? 1 : 0)));

/** A crontab line for systems without systemd or launchd (Windows users: Task Scheduler with the same command). */
export const dreamCronLine = (o: Pick<DreamScheduleOptions, 'node' | 'cli' | 'cwd' | 'hour' | 'minute'>) =>
  `${o.minute ?? 30} ${o.hour ?? 3} * * * ${JSON.stringify(o.node)} ${JSON.stringify(o.cli)} --cwd ${JSON.stringify(o.cwd)} dream`;

export async function installDreamSchedule(options: DreamScheduleOptions): Promise<DreamScheduleResult> {
  const platform = options.platform ?? process.platform;
  const hour = options.hour ?? 3, minute = options.minute ?? 30;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('The dream schedule needs an hour 0-23 and a minute 0-59.');
  const run = options.run ?? exec;
  const path = options.path ?? process.env.PATH ?? '/usr/bin:/bin';
  const name = `edu-dream-${createHash('sha256').update(options.cwd).digest('hex').slice(0, 8)}`;
  const at = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (platform === 'linux') {
    const dir = join(options.home, '.config', 'systemd', 'user');
    await mkdir(dir, { recursive: true });
    const service = join(dir, `${name}.service`), timer = join(dir, `${name}.timer`);
    const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`;
    await writeFile(service, [
      '[Unit]', `Description=Edu: nightly dream plan for ${options.cwd}`, '',
      '[Service]', 'Type=oneshot', `Environment=PATH=${path}`, `WorkingDirectory=${options.cwd}`,
      `ExecStart=${quote(options.node)} ${quote(options.cli)} --cwd ${quote(options.cwd)} dream`, '',
    ].join('\n'));
    await writeFile(timer, [
      '[Unit]', `Description=Edu: dream every night at ${at}`, '',
      '[Timer]', `OnCalendar=*-*-* ${at}:00`, 'Persistent=true', '',
      '[Install]', 'WantedBy=timers.target', '',
    ].join('\n'));
    const started = await run('systemctl', ['--user', 'daemon-reload']) === 0 && await run('systemctl', ['--user', 'enable', '--now', `${name}.timer`]) === 0;
    return { kind: 'systemd', name, files: [service, timer], started };
  }
  if (platform === 'darwin') {
    const dir = join(options.home, 'Library', 'LaunchAgents');
    await mkdir(dir, { recursive: true });
    const label = `dev.edu.${name}`;
    const plist = join(dir, `${label}.plist`);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
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
    await run('launchctl', ['unload', plist]);
    const started = await run('launchctl', ['load', '-w', plist]) === 0;
    return { kind: 'launchd', name, files: [plist], started };
  }
  throw new Error(`A nightly dream is not installed on ${platform}. Schedule this command yourself: ${dreamCronLine({ ...options, hour, minute })}`);
}
